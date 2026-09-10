import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { Prisma, type Policy } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { paymentsAuditLog } from './paymentsAuditMiddleware.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { evaluateIssueReadiness } from '../../policy/app/issueReadiness.js';
import { resolveTenantOrThrow } from '../../../platform/tenant/tenantResolution.js';
import { createCardcorpAutoCheckout } from '../app/cardcorpCheckoutService.js';
import { verifyCardcorpPaymentStatus } from '../app/cardcorpStatusVerificationService.js';
import { applyCardcorpVerifiedStatus } from '../app/cardcorpStatusApplyService.js';
import { processCardcorpWebhookPayload } from '../app/cardcorpWebhookProcessingService.js';
import {
  resolvePublicAppBaseUrlFromRequest,
} from '../../../platform/http/publicAppLinks.js';
import {
  buildPublicSessionTokenRequiredError,
  isPublicSessionModeAllowed,
} from '../../../platform/auth/publicSessionPolicy.js';
import type { PublicSessionResolveMode } from '../../../platform/auth/publicSessionPolicy.js';
import { logger } from '../../../platform/utils/logger.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { optionalAuthenticate } from '../../../platform/http/middleware/auth.js';
import { enforcePolicyProgrammeChannelGate } from '../../policy/http/productChannelGate.js';
import { getCardcorpConfig } from '../app/cardcorpConfig.js';

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  if (value === null || value === undefined) throw new Error('Invalid JSON payload: top-level value cannot be null/undefined');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry === null) return null;
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
        throw new Error('Invalid JSON payload: non-serializable array value');
      }
      return toInputJson(entry);
    });
  }
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
        throw new Error(`Invalid JSON payload at key '${key}': non-serializable value`);
      }
      out[key] = entry === null ? null : toInputJson(entry);
    }
    return out;
  }
  throw new Error('Invalid JSON payload: non-serializable value');
};

const jsonStringify = (data: unknown): Prisma.InputJsonValue => toInputJson(data);

/** Extract result code/description from Payment.raw (stored Json) */
function parsePaymentRawResult(raw: unknown): { code: string; description?: string } {
  const r = parseRecord(raw);
  const result = parseRecord(r?.result);
  return {
    code: String(result?.code ?? ''),
    description: typeof result?.description === 'string' ? result.description : undefined,
  };
}

const router = Router();
const CardcorpWebhookBodySchema = z.record(z.string(), z.unknown());

type PaymentReadinessMissingField = {
  label?: unknown;
  slug?: unknown;
  customerHash?: unknown;
};

/**
 * Customer-safe payment refusal copy. Issue readiness remains the authority;
 * this only projects its first actionable missing field so a customer is not
 * left with the unhelpful impression that their card or payment has failed.
 */
export function formatPaymentReadinessBlockerMessage(blocker: {
  details?: {
    missingForIssuedPack?: unknown;
    missingFields?: unknown;
  };
}): string {
  const details = blocker.details || {};
  const fields = Array.isArray(details.missingForIssuedPack)
    ? details.missingForIssuedPack
    : Array.isArray(details.missingFields)
      ? details.missingFields
      : [];
  const first = (fields[0] && typeof fields[0] === 'object')
    ? fields[0] as PaymentReadinessMissingField
    : null;
  const label = String(first?.label || first?.slug || '').trim();
  const sectionKey = String(first?.customerHash || '')
    .trim()
    .replace(/-/g, ' ');
  const section = sectionKey ? `${sectionKey.charAt(0).toUpperCase()}${sectionKey.slice(1)}` : '';
  if (label && section) {
    return `Please complete ${label} in ${section} before proceeding to payment.`;
  }
  if (label) return `Please complete ${label} before proceeding to payment.`;
  return 'Please complete all required details before proceeding to payment.';
}

// ADR-0101 — populate `req.user` when a BO Bearer token is present so the
// payment channel gate can let a logged-in admin bypass an OFF switch.
router.use(optionalAuthenticate);


const newPublicSessionToken = () => crypto.randomBytes(32).toString('base64url');
const POLICY_START_MAX_DAYS_AHEAD = 45;

function resolveInceptionDateFromRenewalDate(renewalDateRaw: unknown): Date {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const max = new Date(today);
  max.setDate(max.getDate() + POLICY_START_MAX_DAYS_AHEAD);

  if (renewalDateRaw === null || renewalDateRaw === undefined || String(renewalDateRaw).trim() === '') {
    return now;
  }

  const renewalDate = new Date(String(renewalDateRaw));
  if (Number.isNaN(renewalDate.getTime())) {
    throw new Error('Renewal date is invalid');
  }
  const renewalDateOnly = new Date(renewalDate);
  renewalDateOnly.setHours(0, 0, 0, 0);
  if (renewalDateOnly > max) {
    throw new Error(`Renewal date must be between today and ${POLICY_START_MAX_DAYS_AHEAD} days ahead`);
  }
  return renewalDate > now ? renewalDate : now;
}

const CardcorpStatusQuerySchema = z.object({
  checkoutId: z.string().trim().optional(),
  resourcePath: z.string().trim().optional(),
}).refine((value) => Boolean(value.checkoutId || value.resourcePath), {
  message: 'checkoutId or resourcePath is required',
});

async function resolveAutoPolicyByPublicId(policyId: string): Promise<{ policy: Policy | null; mode: PublicSessionResolveMode }> {
  const key = String(policyId || '').trim();
  if (!key) return { policy: null, mode: 'none' as const };

  // PR6: only the opaque public-session token is accepted on public payment
  // endpoints. Legacy UUID / policyNumber lookups were deleted alongside the
  // PUBLIC_SESSION_ALLOW_LEGACY_IDS env flag.
  const byToken = await tenantScopedPrisma.policy.findUnique({ where: { publicSessionToken: key } });
  if (byToken) return { policy: byToken, mode: 'token' as const };

  return { policy: null, mode: 'none' as const };
}

function enforcePublicToken(mode: PublicSessionResolveMode, res: Response) {
  if (isPublicSessionModeAllowed(mode)) return true;
  res.status(401).json(buildPublicSessionTokenRequiredError());
  return false;
}

function readIdempotencyKey(req: Request): string | undefined {
  const key = String(req.get('x-idempotency-key') || '').trim();
  return key ? key.slice(0, 128) : undefined;
}

/**
 * POST /api/public/payments/cardcorp/auto/:policyId/checkout
 * Creates a CardCorp (OPPWA) checkout for the auto quote session.
 */
router.post('/auto/:policyId/checkout', paymentsAuditLog, async (req, res) => {
  try {
    const { policyId } = req.params;
    const cfg = getCardcorpConfig();
    if (!cfg.entityId || !cfg.bearerToken) {
      return res.status(501).json({
        success: false,
        error: { code: 'NOT_CONFIGURED', message: 'CardCorp is not configured on the server' },
      });
    }

    const resolved = await resolveAutoPolicyByPublicId(policyId);
    const policy = resolved.policy;

    if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
    if (!enforcePublicToken(resolved.mode, res)) return;

    // ADR-0101 — refuse online payment when the programme's payment channel is
    // OFF for this tenant (e.g. motor referral-only until Lloyd's approval).
    // A logged-in BO user bypasses; customers get a referral 403.
    if (!(await enforcePolicyProgrammeChannelGate(req, res, policy, 'payment'))) return;

    // Strict issue-readiness: do not open payment until all required issued-pack fields are present.
    const readiness = await evaluateIssueReadiness(policy.id, 'customer');
    const missingIssuedFieldsBlocker = (readiness.blockers || []).find((b) => b.code === 'DOCUMENT_FIELDS_MISSING');
    if (missingIssuedFieldsBlocker) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'ISSUE_READINESS_BLOCKED',
          message: formatPaymentReadinessBlockerMessage(missingIssuedFieldsBlocker),
          details: {
            blocker: missingIssuedFieldsBlocker,
            readiness,
          },
        },
      });
    }

    const idempotencyKey = readIdempotencyKey(req);
    const result = await createCardcorpAutoCheckout({
      policy,
      publicPolicyRequestId: policyId,
      cfg,
      idempotencyKey,
      request: {
        protocol: req.protocol,
        host: String(req.get('host') || ''),
        origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
        ip: String(req.ip || ''),
        xForwardedFor: typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'] : undefined,
        correlationId: req.correlationId,
      },
      parseRecord,
      newPublicSessionToken,
    });
    if (!result.ok) {
      return res.status(result.status).json({ success: false, error: result.error });
    }
    void AuditLogger.log(
      policy.id,
      'POLICY',
      'PAYMENT.CHECKOUT_CREATED',
      'customer',
      'USER',
      { checkoutId: result.data.checkoutId },
      'Customer',
    );
    return res.json({ success: true, data: result.data });
  } catch (error) {
    logger.error({ err: error }, 'CardCorp checkout error:');
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: (error as Error).message } });
  }
});

/**
 * GET /api/public/payments/cardcorp/auto/:policyId/status?checkoutId=...
 * Verifies the payment result with CardCorp and updates policy/payment state.
 */
router.get('/auto/:policyId/status', paymentsAuditLog, async (req, res) => {
  try {
    const { policyId } = req.params;
    const parsed = CardcorpStatusQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid query parameters', details: parsed.error.flatten() },
      });
    }
    const checkoutId = String(parsed.data.checkoutId || '').trim();
    const resourcePath = String(parsed.data.resourcePath || '').trim();

    const cfg = getCardcorpConfig();
    if (!cfg.entityId || !cfg.bearerToken) {
      return res.status(501).json({
        success: false,
        error: { code: 'NOT_CONFIGURED', message: 'CardCorp is not configured on the server' },
      });
    }

    const resolved = await resolveAutoPolicyByPublicId(policyId);
    const policy = resolved.policy;
    if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
    if (!enforcePublicToken(resolved.mode, res)) return;

    const verification = await verifyCardcorpPaymentStatus({
      policyId: policy.id,
      checkoutId,
      resourcePath,
      cfg,
      protocol: req.protocol,
      host: String(req.get('host') || ''),
      origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
      parsePaymentRawResult,
    });
    if (verification.kind === 'error') {
      return res
        .status(verification.status)
        .json({ success: false, error: { code: verification.code, message: verification.message } });
    }
    if (verification.kind === 'response') {
      return res.json({ success: true, data: verification.data });
    }
    const payment = verification.payment;
    const status = verification.status;

    const baseUrl = resolvePublicAppBaseUrlFromRequest(req);

    const applied = await applyCardcorpVerifiedStatus({
      policy: { id: policy.id, policyNumber: policy.policyNumber, productType: policy.productType },
      payment: { id: payment.id, paymentId: payment.paymentId },
      status,
      checkoutId,
      correlationId: req.correlationId,
      baseUrl,
      parseRecord,
      jsonStringify,
      resolveInceptionDateFromRenewalDate,
      resolveTenantId: () => resolveTenantOrThrow(req, 'public'),
    });

    if (status.ok && applied.outcome === 'APPLIED') {
      void AuditLogger.log(
        policy.id,
        'POLICY',
        'PAYMENT.CONFIRMED',
        'customer',
        'USER',
        { checkoutId, paymentId: status.paymentId },
        'Customer',
      );
    }

    return res.json({
      success: true,
      data: {
        ok: status.ok && applied.outcome === 'APPLIED',
        code: applied.outcome === 'CANCELLED' ? 'CHECKOUT_CANCELLED' : status.code,
        description: applied.outcome === 'CANCELLED'
          ? 'This checkout is no longer valid because the quote changed. Please return to the quote and request a new payment link.'
          : status.description,
        paymentStatus: applied.updatedPayment.status,
        policyStatus: status.ok && applied.outcome === 'APPLIED' ? 'PAID' : 'UNPAID',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'CardCorp /status error');
    const msg = (error as Error).message;
    const isUpstream = msg.includes('CardCorp payment status failed');
    // Treat “no payment session” as a verified payment failure / mismatch, not a server error.
    const isNoSession = msg.includes('No payment session found') || msg.includes('200.300.404');
    const isStartDateValidation =
      msg.includes('Renewal date must be between today and') || msg.includes('Renewal date is invalid');
    return res.status(isStartDateValidation ? 400 : (isUpstream ? (isNoSession ? 422 : 502) : 500)).json({
      success: false,
      error: {
        code: isStartDateValidation ? 'BAD_REQUEST' : (isUpstream ? (isNoSession ? 'PAYMENT_NOT_VERIFIED' : 'UPSTREAM_ERROR') : 'SERVER_ERROR'),
        message: msg,
        details: isUpstream ? { originalError: msg } : undefined
      }
    });
  }
});

/**
 * POST /api/public/payments/cardcorp/webhook
 * Webhook receiver (encrypted). For now we just acknowledge with 200 and store raw payload for debugging.
 * CardCorp will provide the decryption secret after the endpoint is configured.
 */
router.post('/webhook', async (req, res) => {
  const parsed = CardcorpWebhookBodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid CardCorp webhook payload', details: parsed.error.flatten() },
    });
  }
  const receivedAt = new Date().toISOString();
  const ivHex = String(req.headers['x-initialization-vector'] || '').trim();
  const tagHex = String(req.headers['x-authentication-tag'] || '').trim();
  const processing = await processCardcorpWebhookPayload({
    body: parsed.data,
    ivHex,
    tagHex,
    receivedAt,
  });
  if (processing.duplicate) {
    return res.status(409).json({
      success: false,
      error: { code: 'DUPLICATE_WEBHOOK', message: 'Duplicate signed webhook payload rejected' },
    });
  }
  return res.sendStatus(200);
});

export default router;
