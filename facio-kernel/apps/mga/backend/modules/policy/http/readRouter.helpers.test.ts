import { describe, expect, it } from 'vitest';
import { buildPolicySearchOrClauses, customerScopedListActor } from './readRouter.helpers.js';

describe('buildPolicySearchOrClauses', () => {
  it('finds an issued policy by its original quote reference', () => {
    expect(buildPolicySearchOrClauses('ABQ/CY1000829')).toContainEqual({
      policy: {
        stateCurrent: {
          is: {
            snapshot: { path: ['quoteId'], equals: 'ABQ/CY1000829' },
          },
        },
      },
    });
  });

  it('normalizes an original quote reference to the canonical stored format', () => {
    expect(buildPolicySearchOrClauses('abq/cy1000829')).toContainEqual({
      policy: {
        stateCurrent: {
          is: {
            snapshot: { path: ['quoteId'], equals: 'ABQ/CY1000829' },
          },
        },
      },
    });
  });
});

describe('customerScopedListActor', () => {
  it('uses the operating-tenant customer account for client policy reads', () => {
    expect(customerScopedListActor(
      { id: 'user_1', role: 'CUSTOMER', email: 'matt@example.com' },
      'pt_customer_account',
    )).toMatchObject({
      id: 'user_1',
      email: 'matt@example.com',
      primaryAccountId: 'pt_customer_account',
    });
  });

  it('does not replace a back-office actor account scope', () => {
    const actor = { id: 'user_2', role: 'ADMIN', primaryAccountId: 'internal_account' };
    expect(customerScopedListActor(actor, 'pt_customer_account')).toBe(actor);
  });
});
