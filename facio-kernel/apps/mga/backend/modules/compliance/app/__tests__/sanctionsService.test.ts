import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuditLogger } from '../../../../platform/audit/logger.js';
import { SanctionsService, SanctionsBlockError } from '../sanctionsService.js';
import { CreditsafeHttpError } from '../../infra/creditsafeClient.js';
import { captureBackgroundException } from '../../../../platform/observability/sentry.js';
import { deriveSanctionsSubjectKey } from '../../domain/sanctionsIdempotency.js';
import type { SanctionsRepository } from '../../infra/sanctionsRepository.js';

vi.mock('../../../../platform/observability/sentry.js', () => ({
  captureBackgroundException: vi.fn(),
}));

type SanctionsRepositoryPort = Pick<
  SanctionsRepository,
  'findReusableScreening' | 'createRunAndDecision' | 'linkReportDocument'
>;

function makeProvider(overrides: Partial<{ searchIndividual: ReturnType<typeof vi.fn>; downloadIndividualSearchPdf: ReturnType<typeof vi.fn> }> = {}) {
  return {
    searchIndividual: overrides.searchIndividual ?? vi.fn(),
    downloadIndividualSearchPdf: overrides.downloadIndividualSearchPdf ?? vi.fn().mockResolvedValue(null),
  };
}

describe('SanctionsService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns allow decision when provider clears', async () => {
    const provider = makeProvider({
      searchIndividual: vi.fn().mockResolvedValue({
        provider: 'creditsafe',
        outcome: 'clear',
        blocking: false,
        hitCount: 0,
        raw: { id: 'run-1' },
      }),
    });
    const repository: SanctionsRepositoryPort = {
      findReusableScreening: vi.fn().mockResolvedValue(null),
      createRunAndDecision: vi.fn().mockImplementation(async (runInput, decisionInput) => ({
        run: { id: 'run-1', ...runInput },
        decision: { id: 'dec-1', ...decisionInput, screeningRunId: 'run-1' },
      })),
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);

    const service = new SanctionsService({
      provider,
      repository,
      threshold: 90,
      datasets: ['SAN-CURRENT'],
    });
    const result = await service.run({
      actionType: 'POLICY_BIND',
      policyId: 'pol-1',
      subjectName: 'Jane Doe',
      correlationId: 'corr-1',
      idempotencyKey: 'corr-1',
    });

    expect(result.canBind).toBe(true);
    expect(result.decision.reasonCode).toBe('NO_HITS');
    expect(provider.searchIndividual).toHaveBeenCalledTimes(1);
  });

  it('forwards DOB to the provider, sends no country, and persists name+DOB request', async () => {
    const searchIndividual = vi.fn().mockResolvedValue({
      provider: 'creditsafe',
      outcome: 'clear',
      blocking: false,
      hitCount: 0,
      raw: { id: 'run-dob' },
    });
    const provider = makeProvider({ searchIndividual });
    const repository: SanctionsRepositoryPort = {
      findReusableScreening: vi.fn().mockResolvedValue(null),
      createRunAndDecision: vi.fn().mockImplementation(async (runInput, decisionInput) => ({
        run: { id: 'run-dob', ...runInput },
        decision: { id: 'dec-dob', ...decisionInput, screeningRunId: 'run-dob' },
      })),
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);

    const service = new SanctionsService({ provider, repository, threshold: 90, datasets: ['SAN-CURRENT'] });
    await service.run({
      actionType: 'QUOTE_RATE',
      policyId: 'pol-dob',
      subjectName: 'Saud Al-Qahtani',
      dateOfBirth: '1978-07-07',
      correlationId: 'corr-dob',
      idempotencyKey: 'idem-dob',
    });

    // Provider is called with name + DOB and no country field.
    expect(searchIndividual).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Saud Al-Qahtani', dateOfBirth: '1978-07-07' }),
    );
    expect(searchIndividual.mock.calls[0][0]).not.toHaveProperty('countryCodes');

    // Persisted run keeps the country column empty and records DOB in requestJson.
    const [runInput] = (repository.createRunAndDecision as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(runInput.countryCodes).toEqual([]);
    expect(runInput.requestJson).toEqual(
      expect.objectContaining({ name: 'Saud Al-Qahtani', dateOfBirth: '1978-07-07' }),
    );
  });

  it('throws sanctions block error when hit is returned', async () => {
    const provider = makeProvider({
      searchIndividual: vi.fn().mockResolvedValue({
        provider: 'creditsafe',
        providerSearchId: 'cs-123',
        outcome: 'possible_match',
        blocking: true,
        hitCount: 1,
        raw: { id: 'cs-123' },
      }),
    });
    const repository: SanctionsRepositoryPort = {
      findReusableScreening: vi.fn().mockResolvedValue(null),
      createRunAndDecision: vi.fn().mockImplementation(async (runInput, decisionInput) => ({
        run: { id: 'run-2', ...runInput },
        decision: { id: 'dec-2', ...decisionInput, screeningRunId: 'run-2' },
      })),
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);
    const service = new SanctionsService({
      provider,
      repository,
      threshold: 90,
      datasets: ['SAN-CURRENT'],
    });

    await expect(
      service.assertClearOrThrow({
        actionType: 'POLICY_BIND',
        policyId: 'pol-2',
        subjectName: 'John Doe',
        correlationId: 'corr-2',
      })
    ).rejects.toBeInstanceOf(SanctionsBlockError);
  });

  it('marks provider unavailable after retry is exhausted', async () => {
    const provider = makeProvider({
      searchIndividual: vi
        .fn()
        .mockRejectedValueOnce(new CreditsafeHttpError('fail-1', 503))
        .mockRejectedValueOnce(new CreditsafeHttpError('fail-2', 503)),
    });
    const repository: SanctionsRepositoryPort = {
      findReusableScreening: vi.fn().mockResolvedValue(null),
      createRunAndDecision: vi.fn().mockImplementation(async (runInput, decisionInput) => ({
        run: { id: 'run-3', ...runInput },
        decision: { id: 'dec-3', ...decisionInput, screeningRunId: 'run-3' },
      })),
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);
    const service = new SanctionsService({
      provider,
      repository,
      threshold: 90,
      datasets: ['SAN-CURRENT'],
    });

    const result = await service.run({
      actionType: 'POLICY_ISSUE',
      policyId: 'pol-3',
      subjectName: 'Fallback User',
      correlationId: 'corr-3',
    });

    expect(provider.searchIndividual).toHaveBeenCalledTimes(2);
    expect(result.run.outcome).toBe('provider_unavailable');
    expect(result.canBind).toBe(false);
    expect(result.decision.reasonCode).toBe('PROVIDER_UNAVAILABLE');

    // The fail-closed turn-away must be surfaced to Sentry so a spike alerts
    // instead of failing silently (the Aug 2026 outage regression).
    expect(captureBackgroundException).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tag: 'sanctions.provider_unavailable' }),
    );
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('SanctionsService — idempotency', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses a prior terminal decision without calling the provider', async () => {
    const cachedResult = {
      run: { id: 'run-cached', outcome: 'clear', provider: 'creditsafe' },
      decision: { id: 'dec-cached', decision: 'allow_bind', reasonCode: 'NO_HITS' },
    };
    const provider = makeProvider();
    const repository: SanctionsRepositoryPort = {
      findReusableScreening: vi.fn().mockResolvedValue(cachedResult),
      createRunAndDecision: vi.fn(),
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);

    const service = new SanctionsService({ provider, repository, threshold: 90, datasets: ['SAN-CURRENT'] });
    const result = await service.run({
      actionType: 'POLICY_BIND',
      policyId: 'pol-idem',
      subjectName: 'Cached Name',
      correlationId: 'corr-idem',
    });

    // Provider must never be called — the reusable decision is authoritative
    expect(provider.searchIndividual).not.toHaveBeenCalled();
    expect(repository.createRunAndDecision).not.toHaveBeenCalled();
    expect(result.canBind).toBe(true);
    expect(result.decision.reasonCode).toBe('NO_HITS');
  });
});

// ─── Stable subject key + no-cache-on-failure (Uriel P0) ─────────────────────

describe('SanctionsService — stable subject-scoped idempotency', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('looks up reuse by a stable subject key, not the per-request correlationId', async () => {
    const findReusableScreening = vi.fn().mockResolvedValue(null);
    const provider = makeProvider({
      searchIndividual: vi.fn().mockResolvedValue({
        provider: 'creditsafe', outcome: 'clear', blocking: false, hitCount: 0, raw: {},
      }),
    });
    const repository: SanctionsRepositoryPort = {
      findReusableScreening,
      createRunAndDecision: vi.fn().mockImplementation(async (runInput, decisionInput) => ({
        run: { id: 'run-sk', ...runInput },
        decision: { id: 'dec-sk', screeningRunId: 'run-sk', ...decisionInput },
      })),
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);

    const service = new SanctionsService({ provider, repository, threshold: 90, datasets: ['SAN-CURRENT'] });
    const expectedKey = deriveSanctionsSubjectKey({ subjectName: 'Jane Doe', dateOfBirth: '1990-01-01' });
    await service.run({
      actionType: 'PAYMENT_CHECKOUT',
      policyId: 'pol-sk',
      subjectName: 'Jane Doe',
      dateOfBirth: '1990-01-01',
      correlationId: 'req-abc-123',
    });

    expect(findReusableScreening).toHaveBeenCalledWith(
      expect.objectContaining({ policyId: 'pol-sk', subjectKey: expectedKey }),
    );
    expect(expectedKey).not.toBe('req-abc-123');
    // A cleared (terminal) run is stamped with the stable key so later gates reuse it.
    const [runInput] = (repository.createRunAndDecision as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(runInput.idempotencyKey).toBe(expectedKey);
  });

  it('rotates the key across reuse windows so a post-window re-screen cannot collide', () => {
    const base = { subjectName: 'Jane Doe', dateOfBirth: '1990-01-01' };
    const k1 = deriveSanctionsSubjectKey({ ...base, at: new Date('2026-08-12T00:00:00Z') });
    const sameWindow = deriveSanctionsSubjectKey({ ...base, at: new Date('2026-08-12T10:00:00Z') });
    const nextWindow = deriveSanctionsSubjectKey({ ...base, at: new Date('2026-08-13T00:00:00Z') });
    // Same 24h window -> same key -> dedup/reuse.
    expect(k1).toBe(sameWindow);
    // Next window -> different key -> a fresh row lands with no unique-constraint clash.
    expect(k1).not.toBe(nextWindow);
  });

  it('collapses concurrent double-clicks onto a single provider call (single-flight)', async () => {
    const searchIndividual = vi.fn().mockImplementation(
      () =>
        new Promise((res) =>
          setTimeout(
            () => res({ provider: 'creditsafe', outcome: 'clear', blocking: false, hitCount: 0, raw: {} }),
            15,
          ),
        ),
    );
    const provider = makeProvider({ searchIndividual });
    const createRunAndDecision = vi.fn().mockImplementation(async (runInput, decisionInput) => ({
      run: { id: 'run-cc', ...runInput },
      decision: { id: 'dec-cc', screeningRunId: 'run-cc', ...decisionInput },
    }));
    const repository: SanctionsRepositoryPort = {
      findReusableScreening: vi.fn().mockResolvedValue(null),
      createRunAndDecision,
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);

    const service = new SanctionsService({ provider, repository, threshold: 90, datasets: ['SAN-CURRENT'] });
    const input = {
      actionType: 'PAYMENT_CHECKOUT' as const,
      policyId: 'pol-cc',
      subjectName: 'Jane Doe',
      dateOfBirth: '1990-01-01',
      correlationId: 'click-1',
    };
    // Both clicks fire before the first provider call resolves. run() registers
    // the single-flight synchronously, so the second call rides the first.
    const [r1, r2] = await Promise.all([
      service.run(input),
      service.run({ ...input, correlationId: 'click-2' }),
    ]);

    // One paid provider call, one persisted run, both callers get the same result.
    expect(searchIndividual).toHaveBeenCalledTimes(1);
    expect(createRunAndDecision).toHaveBeenCalledTimes(1);
    expect(r1.run.id).toBe(r2.run.id);
  });

  it('does NOT persist a stable key for a transient failure, so a retry re-screens', async () => {
    const provider = makeProvider({
      searchIndividual: vi
        .fn()
        .mockRejectedValueOnce(new CreditsafeHttpError('down', 503))
        .mockRejectedValueOnce(new CreditsafeHttpError('down', 503)),
    });
    const repository: SanctionsRepositoryPort = {
      findReusableScreening: vi.fn().mockResolvedValue(null),
      createRunAndDecision: vi.fn().mockImplementation(async (runInput, decisionInput) => ({
        run: { id: 'run-fail', ...runInput },
        decision: { id: 'dec-fail', screeningRunId: 'run-fail', ...decisionInput },
      })),
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);

    const service = new SanctionsService({ provider, repository, threshold: 90, datasets: ['SAN-CURRENT'] });
    const result = await service.run({
      actionType: 'PAYMENT_CHECKOUT',
      policyId: 'pol-fail',
      subjectName: 'Jane Doe',
      correlationId: 'req-1',
    });

    expect(result.run.outcome).toBe('provider_unavailable');
    const [runInput] = (repository.createRunAndDecision as ReturnType<typeof vi.fn>).mock.calls[0];
    // No stable key on a failure — the row is audit-only and never blocks a retry.
    expect(runInput.idempotencyKey).toBeUndefined();
  });
});

// ─── HIT path — explicit assertions ──────────────────────────────────────────

describe('SanctionsService — HIT path assertions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('records BLOCK decision and logs COMPLIANCE.SANCTIONS.BLOCKED on a clean hit', async () => {
    const provider = makeProvider({
      searchIndividual: vi.fn().mockResolvedValue({
        provider: 'creditsafe',
        providerSearchId: 'cs-hit-1',
        outcome: 'hit',
        blocking: true,
        hitCount: 3,
        raw: { matches: 3 },
      }),
    });
    const repository: SanctionsRepositoryPort = {
      findReusableScreening: vi.fn().mockResolvedValue(null),
      createRunAndDecision: vi.fn().mockImplementation(async (runInput, decisionInput) => ({
        run: { id: 'run-hit', providerSearchId: 'cs-hit-1', ...runInput },
        decision: { id: 'dec-hit', screeningRunId: 'run-hit', ...decisionInput },
      })),
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    const auditSpy = vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);

    const service = new SanctionsService({ provider, repository, threshold: 90, datasets: ['SAN-CURRENT'] });

    // assertClearOrThrow must throw SanctionsBlockError
    await expect(
      service.assertClearOrThrow({
        actionType: 'POLICY_BIND',
        policyId: 'pol-hit',
        subjectName: 'Blocked Person',
        correlationId: 'corr-hit',
      })
    ).rejects.toBeInstanceOf(SanctionsBlockError);

    // Repository must record a blocking decision
    expect(repository.createRunAndDecision).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'hit', blocking: true, hitCount: 3 }),
      expect.objectContaining({ decision: expect.stringMatching(/block/) }),
    );

    // Audit log must record the BLOCKED event
    expect(auditSpy).toHaveBeenCalledWith(
      expect.any(String),
      'POLICY',
      'COMPLIANCE.SANCTIONS.BLOCKED',
      'system',
      'SYSTEM',
      expect.any(Object),
    );
  });

  it('SanctionsBlockError carries outcome and reasonCode from the persisted decision', async () => {
    const provider = makeProvider({
      searchIndividual: vi.fn().mockResolvedValue({
        provider: 'creditsafe',
        outcome: 'possible_match',
        blocking: true,
        hitCount: 1,
        raw: {},
      }),
    });
    const repository: SanctionsRepositoryPort = {
      findReusableScreening: vi.fn().mockResolvedValue(null),
      createRunAndDecision: vi.fn().mockImplementation(async (runInput, decisionInput) => ({
        run: { id: 'run-pm', providerSearchId: undefined, ...runInput },
        decision: { id: 'dec-pm', screeningRunId: 'run-pm', ...decisionInput },
      })),
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);

    const service = new SanctionsService({ provider, repository, threshold: 90, datasets: ['SAN-CURRENT'] });

    const error = await service.assertClearOrThrow({
      actionType: 'POLICY_BIND',
      policyId: 'pol-pm',
      subjectName: 'Partial Match',
      correlationId: 'corr-pm',
    }).catch((e) => e);

    expect(error).toBeInstanceOf(SanctionsBlockError);
    expect(error.code).toBe('SANCTION_SCREENING_BLOCKED');
    expect(typeof error.reasonCode).toBe('string');
    expect(error.reasonCode.length).toBeGreaterThan(0);
  });

  it('forwards firstHit projection from provider into run input', async () => {
    const firstHit = {
      matchScore: 100,
      name: 'Saud Al-Qahtani',
      country: 'SA',
      dateOfBirth: '1978-07-07',
      gender: 'Male',
      pepTier: 'PepTier1',
      reasonsListed: 'PEP-CURRENT, AM, SAN-CURRENT',
      hitId: '2903697c-6d6c-493c-bc75-393a095e1152',
      hitIdsAll: ['2903697c-6d6c-493c-bc75-393a095e1152'],
    };
    const provider = makeProvider({
      searchIndividual: vi.fn().mockResolvedValue({
        provider: 'creditsafe',
        providerSearchId: 'd5c1943a-1d18-4988-a9fe-bb9301c391dc',
        outcome: 'possible_match',
        blocking: true,
        hitCount: 1,
        firstHit,
        raw: { id: 'd5c1943a-1d18-4988-a9fe-bb9301c391dc', hits: [{ id: firstHit.hitId }] },
      }),
      // Stub the PDF download so the service doesn't try to upload to storage.
      // The "really stores PDF" branch is exercised by the smoke script
      // against the live Creditsafe API rather than in unit tests.
      downloadIndividualSearchPdf: vi.fn().mockResolvedValue(null),
    });
    const repository: SanctionsRepositoryPort = {
      findReusableScreening: vi.fn().mockResolvedValue(null),
      createRunAndDecision: vi.fn().mockImplementation(async (runInput, decisionInput) => ({
        run: { id: 'run-qahtani', providerSearchId: 'd5c1943a-1d18-4988-a9fe-bb9301c391dc', ...runInput },
        decision: { id: 'dec-qahtani', screeningRunId: 'run-qahtani', ...decisionInput },
      })),
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);

    const service = new SanctionsService({ provider, repository, threshold: 90, datasets: ['SAN-CURRENT'] });
    const result = await service.run({
      actionType: 'POLICY_BIND',
      policyId: 'pol-qahtani',
      subjectName: 'Saud Al-Qahtani',
      dateOfBirth: '1978-07-07',
      correlationId: 'corr-qahtani',
    });

    expect(repository.createRunAndDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        firstHit,
        hitCount: 1,
        outcome: 'possible_match',
        providerSearchId: 'd5c1943a-1d18-4988-a9fe-bb9301c391dc',
      }),
      expect.any(Object),
    );
    expect(provider.downloadIndividualSearchPdf).toHaveBeenCalledWith({
      searchId: 'd5c1943a-1d18-4988-a9fe-bb9301c391dc',
      hitIds: firstHit.hitIdsAll,
    });
    expect(result.canBind).toBe(false);
    expect(result.run.firstHit?.hitId).toBe(firstHit.hitId);
  });

  it('does not fetch a PDF report for non-blocking hits', async () => {
    const firstHit = {
      matchScore: 98,
      name: 'Name Collision',
      country: 'CY',
      dateOfBirth: '',
      gender: 'Female',
      pepTier: '',
      reasonsListed: 'PEP-LINKED',
      hitId: 'name-only-hit',
      hitIdsAll: ['name-only-hit'],
    };
    const provider = makeProvider({
      searchIndividual: vi.fn().mockResolvedValue({
        provider: 'creditsafe',
        providerSearchId: 'cs-name-only',
        outcome: 'non_blocking_hit',
        blocking: false,
        hitCount: 1,
        firstHit,
        raw: { id: 'cs-name-only', hits: [{ id: firstHit.hitId }] },
      }),
      downloadIndividualSearchPdf: vi.fn().mockResolvedValue(null),
    });
    const repository: SanctionsRepositoryPort = {
      findReusableScreening: vi.fn().mockResolvedValue(null),
      createRunAndDecision: vi.fn().mockImplementation(async (runInput, decisionInput) => ({
        run: { id: 'run-name-only', providerSearchId: 'cs-name-only', ...runInput },
        decision: { id: 'dec-name-only', screeningRunId: 'run-name-only', ...decisionInput },
      })),
      linkReportDocument: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AuditLogger, 'log').mockResolvedValue(undefined);

    const service = new SanctionsService({ provider, repository, threshold: 90, datasets: ['SAN-CURRENT'] });
    const result = await service.run({
      actionType: 'QUOTE_RATE',
      policyId: 'pol-name-only',
      subjectName: 'Name Collision',
      dateOfBirth: '1980-01-01',
      correlationId: 'corr-name-only',
    });

    expect(result.canBind).toBe(true);
    expect(result.decision.reasonCode).toBe('NON_BLOCKING_HITS');
    expect(result.run.hitCount).toBe(1);
    expect(result.run.outcome).toBe('non_blocking_hit');
    expect(provider.downloadIndividualSearchPdf).not.toHaveBeenCalled();
  });
});
