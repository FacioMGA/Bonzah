import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ABY-275 / ABY-274 — Cardog catalog-gap email worker.
 *
 * Producer is `backend/modules/policy/http/publicVehiclesRouter.ts`'s
 * `POST /api/public/vehicles/suggest`, which writes a canonical
 * `DomainEventEnvelope` to the outbox. The relay forwards the full
 * envelope as `job.data`. These tests pin both the envelope-read
 * contract (mirroring ADR-0013 / `DOC.GENERATE_ISSUED_POLICY_PACK`)
 * AND the recipient policy that the product owner agreed (Liav,
 * 2026-05-24, refreshed 2026-06-02 when CarDog moved primary contact to
 * Vin on `cardog.app`): TO vin@cardog.app, CC sam@cardog.app +
 * sam@cardog.io + uriel@facio.io + yuval@facio.io, with env overrides
 * for QA / dev environments.
 */

const sgSendMock = vi.fn(async () => undefined);
const sgSetApiKeyMock = vi.fn();
const smtpSendMailMock = vi.fn(async () => undefined);

vi.mock('@sendgrid/mail', () => ({
  default: {
    send: (...args: unknown[]) => sgSendMock(...args),
    setApiKey: (...args: unknown[]) => sgSetApiKeyMock(...args),
  },
}));

vi.mock('../../../platform/events/smtpClient.js', () => ({
  smtpSendMail: (...args: unknown[]) => smtpSendMailMock(...args),
}));

const { runCardogModelSuggestion } = await import('../EMAIL.CARDOG_MODEL_SUGGESTION.js');

const ORIGINAL_ENV = { ...process.env };

function buildEnvelope(overrides: Partial<{ make: string; model: string; trim: string; vin: string; note: string; source: string; publicSessionId: string; policyId: string }> = {}): unknown {
  return {
    eventId: 'evt-test',
    eventType: 'EMAIL.CARDOG_MODEL_SUGGESTION',
    aggregateType: 'POLICY',
    aggregateId: 'cardog-suggestion-test',
    data: {
      make: 'Toyota',
      model: 'Hilux',
      ...overrides,
    },
  };
}

describe('EMAIL.CARDOG_MODEL_SUGGESTION handler — envelope contract (ADR-0013)', () => {
  beforeEach(() => {
    sgSendMock.mockClear();
    sgSetApiKeyMock.mockClear();
    smtpSendMailMock.mockClear();
    for (const key of [
      'SENDGRID_API_KEY',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'CARDOG_SUGGESTION_TO',
      'CARDOG_SUGGESTION_CC',
      'CARDOG_SUGGESTION_FROM',
      'CARDOG_SUGGESTION_DISABLED',
      'NOTIFICATIONS_EMAIL_FROM',
      'EMAIL_FROM_ADDRESS',
    ]) {
      delete process.env[key];
    }
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('reads make/model from envelope.data and sends via SendGrid when SENDGRID_API_KEY is set', async () => {
    process.env.SENDGRID_API_KEY = 'SG.fake';
    const result = await runCardogModelSuggestion(buildEnvelope({ make: 'Toyota', model: 'Hilux' }));
    expect(result.status).toBe('sent');
    expect(sgSetApiKeyMock).toHaveBeenCalledWith('SG.fake');
    expect(sgSendMock).toHaveBeenCalledTimes(1);
    const payload = sgSendMock.mock.calls[0]![0] as { to: string; cc: string[]; subject: string; text: string; from: string };
    expect(payload.to).toBe('vin@cardog.app');
    expect(payload.cc).toEqual(['sam@cardog.app', 'sam@cardog.io', 'uriel@facio.io', 'yuval@facio.io']);
    expect(payload.subject).toContain('Toyota');
    expect(payload.subject).toContain('Hilux');
    expect(payload.text).toContain('Make:  Toyota');
    expect(payload.text).toContain('Model: Hilux');
    expect(payload.text).toContain('Hi Vin,');
  });

  it('falls back to SMTP fan-out when SENDGRID_API_KEY is unset and SMTP_HOST is configured', async () => {
    process.env.SMTP_HOST = 'smtp.test.invalid';
    process.env.SMTP_PORT = '587';
    const result = await runCardogModelSuggestion(buildEnvelope({ make: 'BMW', model: 'i7 M70' }));
    expect(result.status).toBe('sent');
    expect(sgSendMock).not.toHaveBeenCalled();
    // 1 TO + 4 CC = 5 SMTP sends
    expect(smtpSendMailMock).toHaveBeenCalledTimes(5);
    const recipients = smtpSendMailMock.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(recipients).toEqual([
      'vin@cardog.app',
      'sam@cardog.app',
      'sam@cardog.io',
      'uriel@facio.io',
      'yuval@facio.io',
    ]);
  });

  it('soft-skips when CARDOG_SUGGESTION_DISABLED=true (used by tests + non-prod environments)', async () => {
    process.env.CARDOG_SUGGESTION_DISABLED = 'true';
    process.env.SENDGRID_API_KEY = 'SG.fake';
    const result = await runCardogModelSuggestion(buildEnvelope());
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('disabled_via_env');
    expect(sgSendMock).not.toHaveBeenCalled();
    expect(smtpSendMailMock).not.toHaveBeenCalled();
  });

  it('honours env overrides for to + cc (per-environment recipient routing)', async () => {
    process.env.SENDGRID_API_KEY = 'SG.fake';
    process.env.CARDOG_SUGGESTION_TO = 'cardog-staging@facio.io';
    process.env.CARDOG_SUGGESTION_CC = 'qa1@facio.io,qa2@facio.io';
    await runCardogModelSuggestion(buildEnvelope());
    const payload = sgSendMock.mock.calls[0]![0] as { to: string; cc: string[] };
    expect(payload.to).toBe('cardog-staging@facio.io');
    expect(payload.cc).toEqual(['qa1@facio.io', 'qa2@facio.io']);
  });

  it('drops cc entirely when CARDOG_SUGGESTION_CC is set to empty string', async () => {
    process.env.SENDGRID_API_KEY = 'SG.fake';
    process.env.CARDOG_SUGGESTION_CC = '';
    await runCardogModelSuggestion(buildEnvelope());
    const payload = sgSendMock.mock.calls[0]![0] as { cc?: unknown };
    expect(payload.cc).toBeUndefined();
  });

  it('rejects an envelope with missing data.make at the parse boundary (no silent return)', async () => {
    process.env.SENDGRID_API_KEY = 'SG.fake';
    await expect(
      runCardogModelSuggestion({ data: { model: 'Hilux' } }),
    ).rejects.toThrow(/make/i);
    expect(sgSendMock).not.toHaveBeenCalled();
  });

  it('rejects an envelope with empty data.make at the parse boundary with the canonical error message', async () => {
    process.env.SENDGRID_API_KEY = 'SG.fake';
    await expect(
      runCardogModelSuggestion({ data: { make: '', model: 'Hilux' } }),
    ).rejects.toThrow(/missing envelope\.data\.make/i);
    expect(sgSendMock).not.toHaveBeenCalled();
  });

  it('rejects an envelope with missing data.model at the parse boundary', async () => {
    process.env.SENDGRID_API_KEY = 'SG.fake';
    await expect(
      runCardogModelSuggestion({ data: { make: 'Toyota' } }),
    ).rejects.toThrow(/model/i);
  });

  it('rejects a flat (non-enveloped) payload — regression guard for ADR-0013 envelope contract', async () => {
    process.env.SENDGRID_API_KEY = 'SG.fake';
    await expect(
      runCardogModelSuggestion({ make: 'Toyota', model: 'Hilux' }),
    ).rejects.toThrow();
    expect(sgSendMock).not.toHaveBeenCalled();
  });

  it('throws (not soft-skips) when neither SendGrid nor SMTP is configured', async () => {
    await expect(runCardogModelSuggestion(buildEnvelope())).rejects.toThrow(/SENDGRID_API_KEY not set and SMTP_HOST is also missing/i);
  });

  it('includes optional trim, source, publicSessionId, policyId in the email body when present', async () => {
    process.env.SENDGRID_API_KEY = 'SG.fake';
    await runCardogModelSuggestion(buildEnvelope({
      make: 'Toyota',
      model: 'Hilux',
      trim: '2.8 GR Sport',
      source: 'manual_model_entry',
      publicSessionId: 'pub_123',
      policyId: 'pol_xyz',
    }));
    const payload = sgSendMock.mock.calls[0]![0] as { text: string; subject: string };
    expect(payload.text).toContain('Trim:  2.8 GR Sport');
    expect(payload.text).toContain('Origin (source):     manual_model_entry');
    expect(payload.text).toContain('Public session ID:    pub_123');
    expect(payload.text).toContain('Policy ID:            pol_xyz');
    expect(payload.subject).toContain('2.8 GR Sport');
  });

  it('includes the failing VIN in the email body when envelope.data.vin is present (Vin @ CarDog 2026-06-02)', async () => {
    process.env.SENDGRID_API_KEY = 'SG.fake';
    await runCardogModelSuggestion(buildEnvelope({
      make: 'Toyota',
      model: 'Hilux',
      vin: 'JTEBR3FJ60K123456',
      source: 'manual_model_entry',
    }));
    const payload = sgSendMock.mock.calls[0]![0] as { text: string; subject: string };
    expect(payload.text).toContain('VIN (failed to decode): JTEBR3FJ60K123456');
  });

  it('omits the VIN line entirely when envelope.data.vin is absent (back-compat with VIN-less producers)', async () => {
    process.env.SENDGRID_API_KEY = 'SG.fake';
    await runCardogModelSuggestion(buildEnvelope({ make: 'Toyota', model: 'Hilux' }));
    const payload = sgSendMock.mock.calls[0]![0] as { text: string };
    expect(payload.text).not.toContain('VIN');
    expect(payload.text).not.toContain('failed to decode');
  });
});
