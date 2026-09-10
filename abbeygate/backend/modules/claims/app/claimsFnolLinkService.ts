import jwt from 'jsonwebtoken';

import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { executeClaimWorksheetCommand } from '../domain/worksheetCommands.js';
import { sendFnolIntakeLinkEmail } from '../../communications/domain/notifications/email.js';
import { resolvePublicAppBaseUrlFromTenant } from '../../../platform/http/publicAppLinks.js';

type SendFnolLinkInput = {
  claimId: string;
  requestedEmail?: string;
  actor: {
    actorType: 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS';
    actorId: string;
    actorName: string;
  };
};

type SendFnolLinkResult =
  | { ok: true; recipientEmail: string; fnolLink: string }
  | { ok: false; code: string; message: string; status: number };

function firstEmail(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? String(m[0]).trim() : '';
}

export async function sendFnolLinkForClaim(input: SendFnolLinkInput): Promise<SendFnolLinkResult> {
  const claim = await tenantScopedPrisma.claim.findUnique({
    where: { id: input.claimId },
    include: { policy: { include: { policyHolder: true } } },
  });
  if (!claim) {
    return { ok: false, code: 'NOT_FOUND', message: 'Claim not found', status: 404 };
  }
  if (!claim.policyId) {
    return {
      ok: false,
      code: 'POLICY_NOT_LINKED',
      message: 'Cannot send FNOL link before policy is linked',
      status: 409,
    };
  }

  const recipientEmail = input.requestedEmail || firstEmail(claim.policy?.policyHolder?.contact);
  if (!recipientEmail) {
    return {
      ok: false,
      code: 'POLICYHOLDER_EMAIL_REQUIRED',
      message: 'Policyholder email is required to send FNOL link',
      status: 400,
    };
  }

  const jwtSecret = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';
  const token = jwt.sign(
    {
      purpose: 'PUBLIC_FNOL',
      claimId: claim.id,
      policyId: claim.policyId,
    },
    jwtSecret,
    { expiresIn: '14d' },
  );
  // Tenant-aware: this service is invoked from BO endpoints inside the
  // operating-tenant ALS scope. The helper returns the tenant's
  // `publicBaseUrl`, falling back to env vars only outside ALS.
  const appBase = resolvePublicAppBaseUrlFromTenant();
  const fnolLink = `${appBase}/fnol/${encodeURIComponent(token)}`;

  const sent = await sendFnolIntakeLinkEmail({
    toEmail: recipientEmail,
    contactName: String(claim.policy?.policyHolder?.name || ''),
    fnolLink,
    claimReference: claim.claimNumber,
    policyNumber: String(claim.policy?.policyNumber || ''),
    expiresInDays: 14,
    claimId: claim.id,
    policyId: String(claim.policyId || ''),
  });
  if (!sent) {
    return { ok: false, code: 'EMAIL_SEND_FAILED', message: 'Failed to send FNOL link email', status: 502 };
  }

  const nowIso = new Date().toISOString();
  await executeClaimWorksheetCommand({
    claimId: claim.id,
    type: 'SEND_FNOL_LINK',
    payload: {
      sentAt: nowIso,
      channel: 'EMAIL',
      recipient: recipientEmail,
    },
    input: input.actor,
  });
  await executeClaimWorksheetCommand({
    claimId: claim.id,
    type: 'LOG_COMMUNICATION_SENT',
    payload: {
      occurredAt: nowIso,
      communicationType: 'FNOL_LINK',
      partyType: 'FIRST_PARTY',
      channel: 'EMAIL',
    },
    input: input.actor,
  });

  return { ok: true, recipientEmail, fnolLink };
}
