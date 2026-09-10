// Authority lifecycle window gate. Blocks issuance when the policy
// inception date falls outside Program / Binder / BinderProductAuthority
// effectiveness windows OR when any of those entities is non-ACTIVE.
//
// Extracted from `../issueReadiness.ts` in sprint follow-up F4b.

import type { IssueReadinessRepository } from '../issueReadinessRepositoryPort.js';
import type { IssueBlocker } from '../issueReadinessTypes.js';
import { asRecord, parseSnapshot } from '../issueReadinessGuards.js';

function inWindow(
  inceptionDate: Date | null | undefined,
  from: Date | null | undefined,
  to: Date | null | undefined,
): boolean {
  if (!inceptionDate) return true;
  const t = new Date(inceptionDate).getTime();
  if (Number.isNaN(t)) return true;
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime()) return false;
  return true;
}

function isCommittedBdxImportPolicy(snapshot: unknown): boolean {
  const bdxImport = asRecord(parseSnapshot(snapshot).bdxImport);
  if (Object.keys(bdxImport).length === 0) return false;
  return bdxImport.dryRun === false;
}

export async function evaluateAuthorityWindowBlockers(
  repository: IssueReadinessRepository,
  policyId: string,
  productType: string | null,
): Promise<IssueBlocker[]> {
  const ctx = await repository.findAuthorityWindowContext(policyId, productType);
  if (!ctx) return [];
  const blockers: IssueBlocker[] = [];
  const inception = ctx.policy.inceptionDate ?? null;
  const committedBdxImport = isCommittedBdxImportPolicy(ctx.policy.stateCurrent?.snapshot);

  if (ctx.program) {
    const status = String(ctx.program.status || '').trim().toUpperCase();
    if (status && status !== 'ACTIVE') {
      blockers.push({
        code: 'PROGRAM_NOT_ACTIVE',
        message: `Program '${ctx.program.name || ctx.program.id}' is ${status}; issuance is blocked until the program is ACTIVE.`,
        group: 'OTHER',
        severity: 'BLOCK',
        details: { programId: ctx.program.id, status },
      });
    }
    if (!inWindow(inception, ctx.program.effectiveFrom, ctx.program.effectiveTo)) {
      blockers.push({
        code: 'PROGRAM_OUT_OF_WINDOW',
        message: `Program '${ctx.program.name || ctx.program.id}' is not effective at the policy inception date.`,
        group: 'OTHER',
        severity: 'BLOCK',
        details: {
          programId: ctx.program.id,
          inceptionDate: inception?.toISOString() ?? null,
          effectiveFrom: ctx.program.effectiveFrom?.toISOString() ?? null,
          effectiveTo: ctx.program.effectiveTo?.toISOString() ?? null,
        },
      });
    }
  }

  if (ctx.binder) {
    const status = String(ctx.binder.status || '').trim().toUpperCase();
    if (status && status !== 'ACTIVE' && !committedBdxImport) {
      blockers.push({
        code: 'BINDER_NOT_ACTIVE',
        message: `Binder '${ctx.binder.agreementNumber || ctx.binder.id}' is ${status}; issuance is blocked until the binder is ACTIVE.`,
        group: 'OTHER',
        severity: 'BLOCK',
        details: { binderId: ctx.binder.id, status },
      });
    }
    if (!inWindow(inception, ctx.binder.startDate, ctx.binder.endDate)) {
      blockers.push({
        code: 'BINDER_OUT_OF_WINDOW',
        message: `Binder '${ctx.binder.agreementNumber || ctx.binder.id}' is not effective at the policy inception date.`,
        group: 'OTHER',
        severity: 'BLOCK',
        details: {
          binderId: ctx.binder.id,
          inceptionDate: inception?.toISOString() ?? null,
          startDate: ctx.binder.startDate?.toISOString() ?? null,
          endDate: ctx.binder.endDate?.toISOString() ?? null,
        },
      });
    }
  }

  if (ctx.binderAuthority) {
    const status = String(ctx.binderAuthority.status || '').trim().toUpperCase();
    if (status && status !== 'ACTIVE') {
      blockers.push({
        code: 'BINDER_AUTHORITY_NOT_ACTIVE',
        message: `Product authority on this binder is ${status}; issuance is blocked until the authority is ACTIVE.`,
        group: 'OTHER',
        severity: 'BLOCK',
        details: { authorityId: ctx.binderAuthority.id, status },
      });
    }
    if (!inWindow(inception, ctx.binderAuthority.effectiveFrom, ctx.binderAuthority.effectiveTo)) {
      blockers.push({
        code: 'BINDER_AUTHORITY_OUT_OF_WINDOW',
        message: 'Product authority on this binder is not effective at the policy inception date.',
        group: 'OTHER',
        severity: 'BLOCK',
        details: {
          authorityId: ctx.binderAuthority.id,
          inceptionDate: inception?.toISOString() ?? null,
          effectiveFrom: ctx.binderAuthority.effectiveFrom?.toISOString() ?? null,
          effectiveTo: ctx.binderAuthority.effectiveTo?.toISOString() ?? null,
        },
      });
    }
  }

  return blockers;
}
