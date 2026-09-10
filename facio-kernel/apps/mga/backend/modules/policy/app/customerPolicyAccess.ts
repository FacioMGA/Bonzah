import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { buildCustomerPolicyEmailMatchOr } from './read/listPoliciesUseCase.js';

export type PolicyAccessActor = { role?: string; primaryAccountId?: string; email?: string };

type ContactEmailFields = { email?: unknown; Email?: unknown; eMail?: unknown };

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function extractContactEmail(contactRaw: unknown): string {
  if (!contactRaw) return '';
  if (typeof contactRaw === 'object') {
    const rec = contactRaw as ContactEmailFields;
    return normalizeEmail(rec.email || rec.Email || rec.eMail);
  }
  const text = String(contactRaw);
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return '';
    const rec = parsed as ContactEmailFields;
    return normalizeEmail(rec.email || rec.Email || rec.eMail);
  } catch {
    return '';
  }
}

function extractQuoteProposerEmail(quoteData: unknown): string {
  if (!quoteData || typeof quoteData !== 'object') return '';
  const proposer = (quoteData as { proposer?: unknown }).proposer;
  if (!proposer || typeof proposer !== 'object') return '';
  const email = (proposer as ContactEmailFields).email;
  return normalizeEmail(email);
}

function customerEmailMatchesPolicy(actorEmail: string, policy: {
  policyHolder?: { contact?: unknown } | null;
  quoteData?: unknown;
}): boolean {
  const email = normalizeEmail(actorEmail);
  if (!email) return false;

  const holderEmail = extractContactEmail(policy.policyHolder?.contact);
  if (holderEmail && holderEmail === email) return true;

  const proposerEmail = extractQuoteProposerEmail(policy.quoteData);
  return Boolean(proposerEmail) && proposerEmail === email;
}

async function resolveCustomerPolicyAccess(
  actor: PolicyAccessActor,
  policyId: string,
): Promise<'missing' | 'ok' | 'denied'> {
  const policy = await tenantScopedPrisma.policy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      accountId: true,
      quoteData: true,
      policyHolder: { select: { contact: true } },
    },
  });
  if (!policy) return 'missing';
  const primaryAccountId = actor.primaryAccountId ? String(actor.primaryAccountId) : '';
  if (primaryAccountId && String(policy.accountId || '') === primaryAccountId) return 'ok';
  const email = normalizeEmail(actor.email);
  return customerEmailMatchesPolicy(email, policy) ? 'ok' : 'denied';
}

export async function customerCanAccessPolicy(actor: PolicyAccessActor, policyId: string): Promise<boolean> {
  return (await resolveCustomerPolicyAccess(actor, policyId)) === 'ok';
}

export async function listCustomerOwnedPolicyIds(actor: PolicyAccessActor): Promise<string[]> {
  const primaryAccountId = actor.primaryAccountId ? String(actor.primaryAccountId).trim() : '';
  const rawEmail = String(actor.email || '').trim();
  const or = [
    ...(primaryAccountId ? [{ accountId: primaryAccountId }] : []),
    ...buildCustomerPolicyEmailMatchOr(rawEmail),
  ];
  if (!or.length) return [];

  const rows = await tenantScopedPrisma.policy.findMany({
    where: { OR: or },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export { resolveCustomerPolicyAccess };
