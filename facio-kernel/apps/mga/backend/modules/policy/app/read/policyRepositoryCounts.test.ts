import { describe, expect, it } from 'vitest';
import { buildPolicyCountWhere, csvStringToArray } from './policyRepositoryCounts.js';
import { buildCustomerPolicyScopeOr } from './listPoliciesUseCase.js';

describe('policyRepositoryCounts', () => {
  it('parses comma-separated status filters', () => {
    expect(csvStringToArray('ACTIVE, REFERRAL , ,ISSUED')).toEqual(['ACTIVE', 'REFERRAL', 'ISSUED']);
  });

  it('builds inception-date where clauses with optional migration filter', () => {
    const where = buildPolicyCountWhere({
      dateBasis: 'inceptionDate',
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-12-31T23:59:59.999Z'),
      programId: 'prog-1',
      binderId: 'binder-1',
      statusIn: ['ACTIVE', 'REFERRAL'],
      bdxOnly: true,
    });
    const baseClause = Array.isArray(where.AND) ? where.AND[0] as Record<string, unknown> : where;
    expect(baseClause.inceptionDate).toBeTruthy();
    expect(baseClause.programId).toBe('prog-1');
    expect(baseClause.binderId).toBe('binder-1');
    expect(where.status).toEqual({ in: ['ACTIVE', 'REFERRAL'] });
    const andClauses = Array.isArray(where.AND) ? where.AND as Array<Record<string, unknown>> : [];
    expect(andClauses.some((clause) => Array.isArray(clause.OR))).toBe(true);
  });

  it('applies customer visibility scoping under where.AND so it composes with other filters', () => {
    // Counts and listing MUST share the same customer scope. Rather than
    // re-pin the OR clause shape here (which historically drifted from
    // the canonical owner and pinned obsolete `quoteData.path:['email']`
    // paths), assert that the composed OR is byte-for-byte the output of
    // the canonical helper. See `__tests__/buildCustomerPolicyScopeOr.test.ts`
    // for the authoritative shape contract.
    const actor = {
      role: 'CUSTOMER' as const,
      primaryAccountId: 'acc-1',
      email: 'customer@example.com',
    };
    const where = buildPolicyCountWhere({ dateBasis: 'createdAt', actor });
    expect(Array.isArray(where.AND)).toBe(true);
    const andClauses = where.AND as Array<{ OR?: unknown[] }>;
    const customerOr = andClauses.find((clause) => Array.isArray(clause?.OR));
    expect(customerOr).toBeDefined();
    expect(customerOr?.OR).toEqual(buildCustomerPolicyScopeOr(actor));
  });
});
