/**
 * resolveBusinessObject — map identifiers extracted from an ingested
 * email onto a canonical business object (ADR-0044).
 *
 * Resolution order (per spec):
 *   1. Claim (by id or claim number).
 *   2. Underwriting submission (Policy by id / policy number / UMR).
 *   3. Otherwise UNRESOLVED — visible but not yet linked.
 *
 * App layer: reads canonical Postgres via the tenant-scoped client. Does
 * not write. The COMM.EMAIL_INGESTED handler uses the result to enqueue
 * the correct memory refresh.
 */

import { tenantScopedPrisma } from '../../../platform/db/connection.js';

export interface ExtractedIdentifiers {
  claimId?: string | null;
  claimReference?: string | null;
  policyId?: string | null;
  policyReference?: string | null;
  submissionId?: string | null;
  vehicleRegistration?: string | null;
  contactEmails?: string[];
}

export type ResolvedScope =
  | {
      scopeType: 'CLAIM';
      scopeId: string;
      claimNumber: string;
      policyId: string | null;
      matchedBy: string;
    }
  | {
      scopeType: 'SUBMISSION';
      scopeId: string;
      policyNumber: string;
      matchedBy: string;
    }
  | { scopeType: 'UNRESOLVED'; reason: string };

function clean(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

async function resolveClaim(ids: ExtractedIdentifiers): Promise<ResolvedScope | null> {
  const id = clean(ids.claimId);
  const ref = clean(ids.claimReference);
  if (!id && !ref) return null;

  const claim = await tenantScopedPrisma.claim.findFirst({
    where: {
      OR: [...(id ? [{ id }] : []), ...(ref ? [{ claimNumber: ref }] : [])],
    },
    select: { id: true, claimNumber: true, policyId: true },
  });
  if (!claim) return null;
  return {
    scopeType: 'CLAIM',
    scopeId: claim.id,
    claimNumber: claim.claimNumber,
    policyId: claim.policyId,
    matchedBy: id && claim.id === id ? 'claim_id' : 'claim_number',
  };
}

async function resolveSubmission(ids: ExtractedIdentifiers): Promise<ResolvedScope | null> {
  const id = clean(ids.submissionId) || clean(ids.policyId);
  const ref = clean(ids.policyReference);
  if (!id && !ref) return null;

  const policy = await tenantScopedPrisma.policy.findFirst({
    where: {
      OR: [
        ...(id ? [{ id }] : []),
        ...(ref ? [{ policyNumber: ref }, { umr: ref }] : []),
      ],
    },
    select: { id: true, policyNumber: true },
  });
  if (!policy) return null;
  return {
    scopeType: 'SUBMISSION',
    scopeId: policy.id,
    policyNumber: policy.policyNumber,
    matchedBy: id && policy.id === id ? 'policy_id' : 'policy_reference',
  };
}

export async function resolveBusinessObject(ids: ExtractedIdentifiers): Promise<ResolvedScope> {
  const claim = await resolveClaim(ids);
  if (claim) return claim;

  const submission = await resolveSubmission(ids);
  if (submission) return submission;

  const hints: string[] = [];
  if (clean(ids.claimReference)) hints.push(`claimRef=${clean(ids.claimReference)}`);
  if (clean(ids.policyReference)) hints.push(`policyRef=${clean(ids.policyReference)}`);
  if (clean(ids.vehicleRegistration)) hints.push(`vehicle=${clean(ids.vehicleRegistration)}`);
  return {
    scopeType: 'UNRESOLVED',
    reason: hints.length ? `no_match:${hints.join(',')}` : 'no_identifiers',
  };
}
