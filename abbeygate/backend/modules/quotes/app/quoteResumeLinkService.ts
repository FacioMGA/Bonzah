import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import { sendQuoteResumeLinkEmail } from '../../communications/domain/notifications/email.js';
import { normalizePublicAppBaseUrl } from '../../../platform/http/publicAppLinks.js';

/**
 * ABY-259 — app-layer service for the customer-facing "email me a link to
 * resume my quote" action.
 *
 * Lives in `app/` (not `http/`) so the HTTP router stays a thin boundary
 * (layer guard: `tools/quality/check-backend-layer-imports.mjs`). Mirrors
 * the shape of `backend/modules/claims/app/claimsFnolLinkService.ts`,
 * which is the canonical "build URL + dispatch email + return status"
 * service in the platform.
 *
 * The resume URL just deep-links into the wizard. The wizard's
 * `publicSessionToken` has no TTL (see `prisma/schema.prisma:478`) so the
 * customer can click the link at any time and resume their draft.
 */

export type SendQuoteResumeLinkResult =
  | { ok: true; sent: boolean; toEmail: string; resumeUrl: string }
  | { ok: false; code: 'NOT_FOUND' | 'MISSING_EMAIL' | 'EMAIL_SEND_FAILED'; message: string; status: number };

export interface SendQuoteResumeLinkInput {
  productCode: string;
  publicSessionToken: string;
  /** Optional wizard step identifier to deep-link the customer back into. */
  step?: string | null;
  /**
   * Tenant-aware base URL resolved by the caller (HTTP routers should use
   * `resolvePublicAppBaseUrlFromRequest(req)` so origin/x-forwarded headers
   * are honoured; workers can use `resolvePublicAppBaseUrlFromTenant()`).
   */
  baseUrl: string;
}

export async function sendQuoteResumeLinkForSession(
  input: SendQuoteResumeLinkInput,
): Promise<SendQuoteResumeLinkResult> {
  const productCode = String(input.productCode || '').trim().toUpperCase();
  const token = String(input.publicSessionToken || '').trim();
  if (!productCode || !token) {
    return { ok: false, code: 'NOT_FOUND', message: 'Session not found', status: 404 };
  }

  const policy = await tenantScopedPrisma.policy.findFirst({
    where: { publicSessionToken: token, productType: productCode },
  });
  if (!policy) {
    return { ok: false, code: 'NOT_FOUND', message: 'Session not found', status: 404 };
  }

  const state = await tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId: policy.id } });
  const snapshot = parseRecord(state?.snapshot);
  const quoteData = parseRecord(snapshot.quoteData || policy.quoteData);
  const proposer = parseRecord(quoteData.proposer);
  const email = String(proposer.email || '').trim().toLowerCase();
  if (!email) {
    return {
      ok: false,
      code: 'MISSING_EMAIL',
      message: 'Add your email earlier in the wizard before requesting a resume link.',
      status: 422,
    };
  }

  const base = normalizePublicAppBaseUrl(input.baseUrl);
  const url = new URL(`${base}/quote/${encodeURIComponent(token)}`);
  url.searchParams.set('product', productCode.toLowerCase());
  const step = String(input.step || '').trim();
  if (step) url.searchParams.set('step', step);
  const resumeUrl = url.toString();

  const firstName = String(proposer.firstName || '').trim();
  const sent = await sendQuoteResumeLinkEmail({
    toEmail: email,
    firstName,
    resumeUrl,
    policyId: policy.id,
  });

  if (!sent) {
    return { ok: false, code: 'EMAIL_SEND_FAILED', message: 'Failed to send resume link email', status: 502 };
  }

  return { ok: true, sent: true, toEmail: email, resumeUrl };
}
