import type { TenantScopedTx } from '../../../platform/db/connection.js';
import { binderScopesSchema, type BinderScope } from '../domain/questionScopes.js';

/** Tenant transaction only. These are programme authority identities, never quote answer fields. */
export async function readProgrammeScopeBindings(tx: TenantScopedTx, tenantId: string, programId: string, productType: string): Promise<BinderScope[]> {
  const authorities = await tx.binderProductAuthority.findMany({
    where: { operatingTenantId: tenantId, productCode: productType, status: 'ACTIVE', binder: { operatingTenantId: tenantId, status: 'ACTIVE', programLinks: { some: { programId, status: 'ACTIVE' } } } },
    select: { id: true, binder: { select: { id: true, agreementNumber: true } } },
  });
  const binders = new Map<string, BinderScope>();
  for (const authority of authorities) {
    const row: BinderScope = binders.get(authority.binder.id) ?? { binderId: authority.binder.id, name: authority.binder.agreementNumber, authorityIds: [] };
    row.authorityIds.push(authority.id); binders.set(row.binderId, row);
  }
  return binderScopesSchema.parse([...binders.values()].map((row) => ({ ...row, authorityIds: row.authorityIds.sort() })).sort((a, b) => a.binderId.localeCompare(b.binderId)));
}

export function assertRetainedScopeBindings(retained: BinderScope[], current: BinderScope[]): void {
  for (const row of retained) {
    const actual = current.find((candidate) => candidate.binderId === row.binderId);
    if (!actual || actual.name !== row.name || row.authorityIds.some((id) => !actual.authorityIds.includes(id))) throw new Error('Question binder scopes no longer match active programme authorities in this tenant. Save and review a new draft.');
  }
}
