import type { Job } from 'bullmq';
import sgMail from '@sendgrid/mail';
import type { MailDataRequired } from '@sendgrid/helpers/classes/mail.js';
import { z } from 'zod';
import { logger } from '../../platform/utils/logger.js';
import { smtpSendMail } from '../../platform/events/smtpClient.js';
import { registerHandler, type JobHandler } from '../index.js';
// `Job` is value-imported above only as a type via `import type` —
// the side-effect-free `bullmq` symbol must come from the type-only
// import to avoid pulling the BullMQ runtime into the test bundle.

/**
 * EMAIL.CARDOG_MODEL_SUGGESTION worker (ABY-275 / ABY-274).
 *
 * Producer: `backend/modules/policy/http/publicVehiclesRouter.ts`'s
 * `POST /api/public/vehicles/suggest` endpoint, fired whenever the
 * customer or BO underwriter enters a make/model the CarDog catalog
 * does not return. The customer is unblocked immediately (the wizard
 * accepts the manual entry); this worker side-effects the catalog
 * gap upstream so CarDog can add the row.
 *
 * `job.data` arrives as a full `DomainEventEnvelope` from the outbox
 * relay (see `routeEventToQueue` + ADR-0013 / `DOC.GENERATE_ISSUED_POLICY_PACK`).
 * Read strictly from `envelope.data.*`.
 *
 * Recipient policy is hardcoded per the ABY-275 product decision (Liav,
 * 2026-05-24, refreshed 2026-06-02 when CarDog moved its primary contact
 * to Vin on the new `cardog.app` domain) and overridable via env so QA
 * and dev environments do not spam the CarDog catalogue team. To:
 * vin@cardog.app; CC: sam@cardog.app, sam@cardog.io, uriel@facio.io,
 * yuval@facio.io (Sam kept on both domains during the CarDog migration
 * window). Env knobs:
 *
 *   - CARDOG_SUGGESTION_TO        (default: vin@cardog.app)
 *   - CARDOG_SUGGESTION_CC        (CSV; default: sam@cardog.app,sam@cardog.io,uriel@facio.io,yuval@facio.io)
 *   - CARDOG_SUGGESTION_FROM      (default: NOTIFICATIONS_EMAIL_FROM
 *                                   ?? EMAIL_FROM_ADDRESS ?? no-reply@facio.io)
 *   - CARDOG_SUGGESTION_DISABLED  (=true → soft-skip, log only — used
 *                                   by tests + non-prod environments)
 *
 * Delivery prefers SendGrid (which natively supports CC) when
 * SENDGRID_API_KEY is set, falls back to per-recipient SMTP via
 * `smtpClient.smtpSendMail` otherwise. CC fan-out via per-recipient
 * SMTP sends is acceptable here — the body is identical and the email
 * is purely advisory; we do not need a single-message thread.
 */

const DataSchema = z.object({
  make: z.string().trim().min(1, 'EMAIL.CARDOG_MODEL_SUGGESTION missing envelope.data.make'),
  model: z.string().trim().min(1, 'EMAIL.CARDOG_MODEL_SUGGESTION missing envelope.data.model'),
  trim: z.string().trim().optional(),
  // `vin` is the VIN the user entered which CarDog failed to decode
  // (vendor request, Vin @ CarDog 2026-06-02 — wanted in the gap email
  // so their automation can pre-populate the catalogue row). Optional
  // because the manual-model-entry path can fire before any VIN is
  // typed; producer is responsible for omitting an empty value.
  vin: z.string().trim().optional(),
  note: z.string().trim().optional(),
  source: z.string().trim().optional(),
  publicSessionId: z.string().trim().optional(),
  policyId: z.string().trim().optional(),
});

const EnvelopeSchema = z.object({ data: DataSchema });

export type CardogSuggestionData = z.infer<typeof DataSchema>;

const DEFAULT_TO = 'vin@cardog.app';
const DEFAULT_CC = 'sam@cardog.app,sam@cardog.io,uriel@facio.io,yuval@facio.io';

function envCsv(name: string, fallback: string): string[] {
  const raw = String(process.env[name] ?? fallback).trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildSubject(data: CardogSuggestionData): string {
  const parts = [data.make, data.model, data.trim].filter(Boolean).map((part) => String(part).trim()).filter(Boolean);
  return `Abbeygate: missing CarDog vehicle — ${parts.join(' ') || 'unknown'}`;
}

function buildBody(data: CardogSuggestionData): string {
  const lines: string[] = [
    'Hi Vin,',
    '',
    'A user on Abbeygate just entered a vehicle that the CarDog catalog did not return.',
    'Please consider adding this combination so the wizard / underwriting flow can auto-classify next time.',
    '',
    `  Make:  ${data.make}`,
    `  Model: ${data.model}`,
  ];
  if (data.trim) lines.push(`  Trim:  ${data.trim}`);
  if (data.vin) lines.push(`  VIN (failed to decode): ${data.vin}`);
  if (data.note) lines.push(`  Note:  ${data.note}`);
  if (data.source) lines.push(`  Origin (source):     ${data.source}`);
  if (data.publicSessionId) lines.push(`  Public session ID:    ${data.publicSessionId}`);
  if (data.policyId) lines.push(`  Policy ID:            ${data.policyId}`);
  lines.push(
    '',
    'Sent automatically by Abbeygate (FacioMGA) — please reply if you want this routed elsewhere.',
    '',
    '— Abbeygate platform',
  );
  return lines.join('\n');
}

async function sendViaSendgrid(args: {
  apiKey: string;
  from: string;
  to: string;
  cc: string[];
  subject: string;
  text: string;
}): Promise<void> {
  sgMail.setApiKey(args.apiKey);
  const payload: MailDataRequired = {
    to: args.to,
    ...(args.cc.length ? { cc: args.cc } : {}),
    from: args.from,
    subject: args.subject,
    text: args.text,
  };
  await sgMail.send(payload);
}

async function sendViaSmtp(args: {
  from: string;
  to: string;
  cc: string[];
  subject: string;
  text: string;
}): Promise<void> {
  const host = String(process.env.SMTP_HOST || '').trim();
  if (!host) {
    throw new Error('EMAIL.CARDOG_MODEL_SUGGESTION: SENDGRID_API_KEY not set and SMTP_HOST is also missing — cannot deliver.');
  }
  const port = Number(process.env.SMTP_PORT || 587) || 587;
  const secure = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true' || port === 465;
  const user = process.env.SMTP_USER ? String(process.env.SMTP_USER) : undefined;
  const pass = process.env.SMTP_PASS ? String(process.env.SMTP_PASS) : undefined;
  // smtpSendMail takes one recipient; fan out to CC by sending the
  // same body to each. Acceptable for this advisory email — no thread
  // expectation, no envelope-CC requirement.
  const recipients = [args.to, ...args.cc];
  for (const recipient of recipients) {
    await smtpSendMail({
      host,
      port,
      secure,
      ...(user ? { user } : {}),
      ...(pass ? { pass } : {}),
      from: args.from,
      to: recipient,
      subject: args.subject,
      text: args.text,
    });
  }
}

export async function runCardogModelSuggestion(rawJobData: unknown): Promise<{ status: 'sent' | 'skipped'; recipients: string[]; reason?: string }> {
  const { data } = EnvelopeSchema.parse(rawJobData);

  if (String(process.env.CARDOG_SUGGESTION_DISABLED || '').trim().toLowerCase() === 'true') {
    logger.info({
      event: 'cardog_suggestion.skipped',
      reason: 'CARDOG_SUGGESTION_DISABLED=true',
      make: data.make,
      model: data.model,
    }, 'cardog_suggestion.skipped');
    return { status: 'skipped', recipients: [], reason: 'disabled_via_env' };
  }

  const to = String(process.env.CARDOG_SUGGESTION_TO || DEFAULT_TO).trim() || DEFAULT_TO;
  const cc = envCsv('CARDOG_SUGGESTION_CC', DEFAULT_CC);
  const from = String(
    process.env.CARDOG_SUGGESTION_FROM
      || process.env.NOTIFICATIONS_EMAIL_FROM
      || process.env.EMAIL_FROM_ADDRESS
      || 'no-reply@facio.io',
  ).trim();
  const subject = buildSubject(data);
  const text = buildBody(data);

  const apiKey = String(process.env.SENDGRID_API_KEY || '').trim();
  if (apiKey) {
    await sendViaSendgrid({ apiKey, from, to, cc, subject, text });
  } else {
    await sendViaSmtp({ from, to, cc, subject, text });
  }

  logger.info({
    event: 'cardog_suggestion.sent',
    to,
    cc,
    make: data.make,
    model: data.model,
    source: data.source,
  }, 'cardog_suggestion.sent');

  return { status: 'sent', recipients: [to, ...cc] };
}

// Type `Job` with explicit `unknown` data so the resolved type doesn't
// fall back to bullmq's `Job<any, any, string>` default. The
// `EnvelopeSchema.parse` inside `runCardogModelSuggestion` is the
// real type assertion at the untrusted-input boundary. The other
// EMAIL.* handlers (UW_REFERRAL, INFO_REQUIRED, CANCELLATION_*)
// inherit the `Job<any,…>` default — they're in the any-resolved
// baseline. New code (this handler) must not add to it; the
// explicit `unknown` keeps the ceiling stable.
export const handleCardogModelSuggestion: JobHandler = async (job: Job<unknown, unknown, string>) => {
  await runCardogModelSuggestion(job.data);
};

registerHandler('EMAIL.CARDOG_MODEL_SUGGESTION', handleCardogModelSuggestion);
