/**
 * Customer policy scope (PR-1C — `/client` policy listing email-match
 * canonical customer policy listing scope.
 *
 * Pins the OR clauses used to scope the policy listing for a CUSTOMER
 * role. The previous implementation only matched
 * `policyHolder.contact contains email`, which silently misses
 * newly-bound public-flow policies whose canonical email lives only on
 * `quoteData.proposer.email`. This test enforces that:
 *
 *   - primaryAccountId always produces an `accountId` clause first
 *   - email produces a case-insensitive `policyHolder.contact`
 *     contains clause AND JSON-path equals clauses against the canonical
 *     proposer email surface in `quoteData`
 *   - the lowercase variant is also matched (auth-typed `Effie@…`
 *     vs quote-stored `effie@…`)
 *   - empty/anonymous actor returns the locked-out clause so we
 *     don't leak other customers' policies
 *
 * Obsolete flat email paths must not be preserved as policy listing scope.
 */

import { describe, expect, it } from 'vitest';
import { buildCustomerPolicyEmailMatchOr, buildCustomerPolicyScopeOr } from '../listPoliciesUseCase.js';

describe('buildCustomerPolicyEmailMatchOr (canonical email surfaces)', () => {
  it('matches policyHolder.contact and quoteData.proposer.email variants', () => {
    const or = buildCustomerPolicyEmailMatchOr('Effie@abbeygate.cy');
    expect(or).toContainEqual({
      policyHolder: { contact: { contains: 'Effie@abbeygate.cy', mode: 'insensitive' } },
    });
    expect(or).toContainEqual({
      quoteData: { path: ['proposer', 'email'], equals: 'Effie@abbeygate.cy' },
    });
    expect(or).toContainEqual({
      quoteData: { path: ['proposer', 'email'], equals: 'effie@abbeygate.cy' },
    });
  });

  it('does not match obsolete quoteData.email', () => {
    const or = buildCustomerPolicyEmailMatchOr('effie@abbeygate.cy');
    expect(or).not.toContainEqual({
      quoteData: { path: ['email'], equals: 'effie@abbeygate.cy' },
    });
  });
});

describe('buildCustomerPolicyScopeOr (PR-1C customer scope)', () => {
  it('includes accountId clause first when primaryAccountId is set', () => {
    const or = buildCustomerPolicyScopeOr({
      role: 'CUSTOMER',
      primaryAccountId: 'acct_123',
      email: 'user@example.com',
    });
    expect(or[0]).toEqual({ accountId: 'acct_123' });
  });

  it('matches policyHolder.contact case-insensitively (JSON blob substring)', () => {
    const or = buildCustomerPolicyScopeOr({
      role: 'CUSTOMER',
      email: 'Effie@abbeygate.cy',
    });
    expect(or).toContainEqual({
      policyHolder: { contact: { contains: 'Effie@abbeygate.cy', mode: 'insensitive' } },
    });
  });

  it('matches quoteData.proposer.email (canonical) for as-typed and lowercase variants', () => {
    const or = buildCustomerPolicyScopeOr({
      role: 'CUSTOMER',
      email: 'Effie@abbeygate.cy',
    });
    expect(or).toContainEqual({
      quoteData: { path: ['proposer', 'email'], equals: 'Effie@abbeygate.cy' },
    });
    expect(or).toContainEqual({
      quoteData: { path: ['proposer', 'email'], equals: 'effie@abbeygate.cy' },
    });
  });

  it('does not match obsolete quoteData.email', () => {
    const or = buildCustomerPolicyScopeOr({
      role: 'CUSTOMER',
      email: 'effie@abbeygate.cy',
    });
    expect(or).not.toContainEqual({
      quoteData: { path: ['email'], equals: 'effie@abbeygate.cy' },
    });
  });

  it('does not match obsolete quoteData.contactEmail', () => {
    const or = buildCustomerPolicyScopeOr({
      role: 'CUSTOMER',
      email: 'effie@abbeygate.cy',
    });
    expect(or).not.toContainEqual({
      quoteData: { path: ['contactEmail'], equals: 'effie@abbeygate.cy' },
    });
  });

  it('does NOT duplicate the lowercase variant when email is already lowercase', () => {
    const or = buildCustomerPolicyScopeOr({
      role: 'CUSTOMER',
      email: 'effie@abbeygate.cy',
    });
    const proposerEmailMatches = or.filter(
      (clause) =>
        typeof clause === 'object' &&
        clause !== null &&
        'quoteData' in clause &&
        JSON.stringify((clause as { quoteData: unknown }).quoteData).includes('"proposer"'),
    );
    expect(proposerEmailMatches).toHaveLength(1);
  });

  it('returns the never-match clause when neither account nor email is present', () => {
    expect(buildCustomerPolicyScopeOr({ role: 'CUSTOMER' })).toEqual([{ id: '__no_access__' }]);
    expect(buildCustomerPolicyScopeOr(null)).toEqual([{ id: '__no_access__' }]);
    expect(buildCustomerPolicyScopeOr(undefined)).toEqual([{ id: '__no_access__' }]);
    expect(buildCustomerPolicyScopeOr({ role: 'CUSTOMER', email: '   ' })).toEqual([{ id: '__no_access__' }]);
  });

  it('emits an accountId clause AND all email clauses when both are present', () => {
    const or = buildCustomerPolicyScopeOr({
      role: 'CUSTOMER',
      primaryAccountId: 'acct_123',
      email: 'user@example.com',
    });
    expect(or[0]).toEqual({ accountId: 'acct_123' });
    // 1 holder-contact + 1 canonical quoteData path.
    expect(or).toHaveLength(1 + 1 + 1);
  });
});
