import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { storageService } from '../../../platform/storage/service.js';
import { logger } from '../../../platform/utils/logger.js';
import { captureBackgroundException } from '../../../platform/observability/sentry.js';
import {
  mapDecisionFromOutcome,
} from '../domain/sanctionsPolicy.js';
import type { SanctionSearchProvider } from '../domain/sanctionsProvider.js';
import type {
  ComplianceDecisionRecord,
  SanctionFirstHit,
  SanctionOutcome,
  SanctionScreeningRunRecord,
  ScreeningActionType,
  ScreeningDecision,
} from '../domain/sanctionsTypes.js';
import type { SanctionsRepository } from '../infra/sanctionsRepository.js';
import { CreditsafeHttpError, isTransientCreditsafeError } from '../infra/creditsafeClient.js';
import {
  deriveSanctionsSubjectKey,
  isReusableScreeningOutcome,
} from '../domain/sanctionsIdempotency.js';

/** Prisma unique-constraint violation — a concurrent gate persisted first. */
function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Document.type discriminator for Creditsafe AML PDF reports. Kept distinct
 * from the policy document packs (QUOTE_PACK / ISSUED_POLICY_PACK /
 * ENDORSEMENT_PACK) so reporting / BO doc listings never confuse a
 * compliance evidence PDF with a customer-facing policy document.
 */
export const CREDITSAFE_SANCTIONS_REPORT_DOC_TYPE = 'CREDITSAFE_SANCTIONS_REPORT_PDF';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * 250);
}

async function computeSha256(buffer: Buffer): Promise<string> {
  return createHash('sha256').update(buffer).digest('hex');
}

export class SanctionsBlockError extends Error {
  readonly code = 'SANCTION_SCREENING_BLOCKED';
  readonly outcome: SanctionOutcome;
  readonly reasonCode: string;
  readonly providerSearchId?: string;

  constructor(args: {
    outcome: SanctionOutcome;
    reasonCode: string;
    providerSearchId?: string;
    message?: string;
  }) {
    super(args.message || 'Policy cannot proceed until sanctions screening is cleared.');
    this.name = 'SanctionsBlockError';
    this.outcome = args.outcome;
    this.reasonCode = args.reasonCode;
    this.providerSearchId = args.providerSearchId;
  }
}

export type RunSanctionsInput = {
  tenantId?: string;
  policyId?: string | null;
  quoteSessionId?: string | null;
  customerId?: string | null;
  actionType: ScreeningActionType;
  subjectName: string;
  /**
   * Subject date of birth (`YYYY-MM-DD` or `YYYY`). Sent to Creditsafe to
   * screen by name + DOB. Country is no longer part of the search — see
   * ADR-0043. Optional: a name-only search runs when it is absent.
   */
  dateOfBirth?: string;
  correlationId: string;
  idempotencyKey?: string;
};

type SanctionsRepositoryPort = Pick<
  SanctionsRepository,
  'findReusableScreening' | 'createRunAndDecision' | 'linkReportDocument'
>;

export class SanctionsService {
  constructor(
    private readonly deps: {
      provider: SanctionSearchProvider;
      repository: SanctionsRepositoryPort;
      threshold: 75 | 80 | 85 | 90 | 95 | 100;
      datasets: string[];
    }
  ) {}

  private async searchWithSingleRetry(input: {
    name: string;
    dateOfBirth?: string;
    correlationId: string;
  }) {
    try {
      return await this.deps.provider.searchIndividual(input);
    } catch (firstError) {
      if (!isTransientCreditsafeError(firstError)) throw firstError;
      await wait(jitter(500));
      return this.deps.provider.searchIndividual(input);
    }
  }

  async run(input: RunSanctionsInput): Promise<ScreeningDecision> {
    // Stable, subject-scoped dedup key. Callers no longer pass a per-request
    // correlationId as the key (that is what caused every click/retry/gate to
    // pay for a fresh Creditsafe search); the service derives one deterministic
    // key from the insured identity so one paid check covers the whole purchase.
    const subjectKey =
      input.idempotencyKey ||
      deriveSanctionsSubjectKey({ subjectName: input.subjectName, dateOfBirth: input.dateOfBirth });

    // In-process single-flight: collapse concurrent screenings for the same
    // policy + subject (e.g. a genuine double Proceed click, or checkout and a
    // heal firing together) onto ONE provider call within this process, so the
    // paid request happens once before the DB unique constraint is ever tested.
    // The DB constraint remains the cross-process backstop (see executeRun).
    const flightKey = `${input.policyId || 'none'}:${subjectKey}`;
    const inFlight = SanctionsService.inFlight.get(flightKey);
    if (inFlight) return inFlight;
    const flight = this.executeRun(input, subjectKey).finally(() => {
      SanctionsService.inFlight.delete(flightKey);
    });
    SanctionsService.inFlight.set(flightKey, flight);
    return flight;
  }

  /** In-flight screenings keyed by `${policyId}:${subjectKey}` (single-flight). */
  private static readonly inFlight = new Map<string, Promise<ScreeningDecision>>();

  private async executeRun(input: RunSanctionsInput, subjectKey: string): Promise<ScreeningDecision> {
    const reusable = await this.deps.repository.findReusableScreening({
      policyId: input.policyId || null,
      provider: 'creditsafe',
      subjectKey,
    });
    if (reusable) {
      logger.info(
        {
          policyId: input.policyId || null,
          actionType: input.actionType,
          reusedRunId: reusable.run.id,
          reusedOutcome: reusable.run.outcome,
          correlationId: input.correlationId,
        },
        'sanctions.screening.reused'
      );
      return {
        run: reusable.run,
        decision: reusable.decision,
        canBind: reusable.decision.decision === 'allow_bind',
        requiresManualReview: reusable.decision.decision === 'manual_review_required',
      };
    }

    const requestSnapshot = {
      name: input.subjectName,
      dateOfBirth: input.dateOfBirth ?? null,
      threshold: this.deps.threshold,
      datasets: this.deps.datasets,
    };
    await AuditLogger.log(
      input.policyId || input.correlationId,
      'POLICY',
      'COMPLIANCE.SANCTIONS.REQUESTED',
      'system',
      'SYSTEM',
      {
        actionType: input.actionType,
        correlationId: input.correlationId,
        subjectName: input.subjectName,
      }
    );

    let outcome: SanctionOutcome = 'error';
    let responseSnapshot: unknown = {};
    let providerSearchId: string | undefined;
    let hitCount = 0;
    let providerStatus: string | undefined;
    let providerRiskRating: string | undefined;
    let blocking = true;
    let firstHit: SanctionFirstHit | undefined;

    try {
      const providerResult = await this.searchWithSingleRetry({
        name: input.subjectName,
        dateOfBirth: input.dateOfBirth,
        correlationId: input.correlationId,
      });

      outcome = providerResult.outcome;
      responseSnapshot = providerResult.raw;
      providerSearchId = providerResult.providerSearchId;
      hitCount = providerResult.hitCount;
      providerStatus = providerResult.providerStatus;
      providerRiskRating = providerResult.providerRiskRating;
      blocking = providerResult.blocking;
      firstHit = providerResult.firstHit;
    } catch (error) {
      responseSnapshot = {
        error: String(error instanceof Error ? error.message : error),
      };
      outcome = error instanceof CreditsafeHttpError || isTransientCreditsafeError(error)
        ? 'provider_unavailable'
        : 'error';
      blocking = true;
      // Fail-closed: the provider could not screen this subject, so this quote
      // (and every other one right now) is being turned away. A single
      // transient error is normal; a SPIKE means online sales have stopped
      // (the Aug 2026 outage went days unnoticed because a 503 is not a
      // crash). Surface it to Sentry, rate-limited per fingerprint, so an
      // alert can fire instead of the system failing silently.
      captureBackgroundException(error, {
        tag: 'sanctions.provider_unavailable',
        extra: {
          actionType: input.actionType,
          outcome,
          correlationId: input.correlationId,
          tenantId: input.tenantId ?? 'default',
        },
      });
    }

    const decisionMapping = mapDecisionFromOutcome(outcome);
    const now = new Date();
    const runRecordInput: Omit<SanctionScreeningRunRecord, 'id'> = {
      tenantId: input.tenantId || 'default',
      policyId: input.policyId || null,
      quoteSessionId: input.quoteSessionId || null,
      customerId: input.customerId || null,
      provider: 'creditsafe',
      providerSearchId,
      subjectType: 'individual',
      subjectName: input.subjectName,
      // Screening no longer uses country (ADR-0043). The column is retained
      // for schema stability and written empty; the subject DOB lives in
      // `requestJson` above (no migration).
      countryCodes: [],
      threshold: this.deps.threshold,
      datasets: this.deps.datasets,
      actionType: input.actionType,
      outcome,
      blocking,
      hitCount,
      providerStatus,
      providerRiskRating,
      firstHit: firstHit ?? null,
      reportDocumentId: null,
      reportFilename: null,
      requestJson: requestSnapshot,
      responseJson: responseSnapshot,
      executedAt: now,
      correlationId: input.correlationId,
      // Only stamp the stable key on a PAID/terminal result so it becomes the
      // reusable record. Transient failures (provider_unavailable/error) are
      // stored WITHOUT the key so a retry after recovery re-screens instead of
      // being pinned to the outage.
      idempotencyKey: isReusableScreeningOutcome(outcome) ? subjectKey : undefined,
    };

    const decisionInput: Omit<ComplianceDecisionRecord, 'id'> = {
      screeningRunId: '',
      decision: decisionMapping.decision,
      reasonCode: decisionMapping.reasonCode,
      decidedAt: now,
      decidedBy: 'system',
      note: decisionMapping.requiresManualReview
        ? 'Manual review required for sanctions screening hit.'
        : undefined,
    };

    let persisted: { run: SanctionScreeningRunRecord; decision: ComplianceDecisionRecord };
    try {
      persisted = await this.deps.repository.createRunAndDecision(runRecordInput, decisionInput);
    } catch (error) {
      // A concurrent gate (e.g. a double Proceed click) persisted the same
      // stable key first. Rather than 500 or pay twice, adopt that winning
      // record so we still emit exactly one paid check.
      if (isUniqueConstraintError(error)) {
        const winner = await this.deps.repository.findReusableScreening({
          policyId: input.policyId || null,
          provider: 'creditsafe',
          subjectKey,
        });
        if (winner) {
          return {
            run: winner.run,
            decision: winner.decision,
            canBind: winner.decision.decision === 'allow_bind',
            requiresManualReview: winner.decision.decision === 'manual_review_required',
          };
        }
      }
      throw error;
    }
    const eventType =
      outcome === 'clear'
        ? 'COMPLIANCE.SANCTIONS.CLEARED'
        : outcome === 'non_blocking_hit'
          ? 'COMPLIANCE.SANCTIONS.NON_BLOCKING_HIT'
          : outcome === 'provider_unavailable'
            ? 'COMPLIANCE.SANCTIONS.UNAVAILABLE_FAIL_CLOSED'
            : 'COMPLIANCE.SANCTIONS.BLOCKED';

    await AuditLogger.log(
      input.policyId || persisted.run.id,
      'POLICY',
      eventType as Parameters<typeof AuditLogger.log>[2],
      'system',
      'SYSTEM',
      {
        screeningRunId: persisted.run.id,
        outcome,
        reasonCode: persisted.decision.reasonCode,
        actionType: input.actionType,
        correlationId: input.correlationId,
        providerSearchId: persisted.run.providerSearchId || null,
      }
    );

    // PDF report fetch. Creditsafe only produces an AML report for searches
    // that returned hits (and charges credits per PDF), so we only attempt
    // the download when the run is blocking on a real match. A failure here
    // is logged and swallowed — the JSON evidence is already persisted in
    // `responseJson` and the blocking decision is canonical without the
    // PDF; an operator can re-run later.
    const pdfArtifact = await this.maybeFetchAndStoreReportPdf({
      run: persisted.run,
      firstHit,
      correlationId: input.correlationId,
    });

    if (pdfArtifact) {
      persisted.run.reportDocumentId = pdfArtifact.documentId;
      persisted.run.reportFilename = pdfArtifact.filename;
    }

    return {
      run: persisted.run,
      decision: persisted.decision,
      canBind: decisionMapping.canBind,
      requiresManualReview: decisionMapping.requiresManualReview,
    };
  }

  private async maybeFetchAndStoreReportPdf(args: {
    run: SanctionScreeningRunRecord;
    firstHit?: SanctionFirstHit;
    correlationId: string;
  }): Promise<{ documentId: string; filename: string } | null> {
    const { run, firstHit, correlationId } = args;
    if (!run.blocking) return null;
    if (run.hitCount === 0) return null;
    if (!run.providerSearchId) return null;
    const hitIds = firstHit?.hitIdsAll && firstHit.hitIdsAll.length > 0
      ? firstHit.hitIdsAll
      : firstHit?.hitId
        ? [firstHit.hitId]
        : [];
    if (hitIds.length === 0) return null;

    try {
      const report = await this.deps.provider.downloadIndividualSearchPdf({
        searchId: run.providerSearchId,
        hitIds,
      });
      if (!report) return null;

      const uploaded = await storageService.uploadFile(
        report.buffer,
        report.filename,
        report.mimeType
      );
      const fileHash = await computeSha256(report.buffer);
      const docData: Prisma.DocumentUncheckedCreateInput = {
        operatingTenantId: getTenantConfig().id,
        policyId: run.policyId ?? null,
        type: CREDITSAFE_SANCTIONS_REPORT_DOC_TYPE,
        version: 1,
        status: 'GENERATED',
        source: 'SYSTEM',
        storageUri: uploaded.url,
        filename: uploaded.filename,
        fileHash,
      };
      const document = await tenantScopedPrisma.document.create({ data: docData });

      await this.deps.repository.linkReportDocument({
        runId: run.id,
        documentId: document.id,
        filename: uploaded.filename,
        policyId: run.policyId ?? null,
      });

      logger.info(
        {
          screeningRunId: run.id,
          providerSearchId: run.providerSearchId,
          documentId: document.id,
          filename: uploaded.filename,
          hitCount: run.hitCount,
          correlationId,
        },
        'sanctions.report.pdf.stored'
      );

      return { documentId: document.id, filename: uploaded.filename };
    } catch (error) {
      logger.error(
        {
          screeningRunId: run.id,
          providerSearchId: run.providerSearchId,
          correlationId,
          err: error instanceof Error ? { name: error.name, message: error.message } : { value: String(error) },
        },
        'sanctions.report.pdf.fetch_failed'
      );
      return null;
    }
  }

  async assertClearOrThrow(input: RunSanctionsInput): Promise<ScreeningDecision> {
    const decision = await this.run(input);
    if (decision.canBind) return decision;

    logger.warn(
      {
        policyId: input.policyId || null,
        outcome: decision.run.outcome,
        reasonCode: decision.decision.reasonCode,
        screeningRunId: decision.run.id,
        providerSearchId: decision.run.providerSearchId || null,
      },
      'sanctions.screening.blocked'
    );

    throw new SanctionsBlockError({
      outcome: decision.run.outcome,
      reasonCode: decision.decision.reasonCode,
      providerSearchId: decision.run.providerSearchId,
    });
  }
}
