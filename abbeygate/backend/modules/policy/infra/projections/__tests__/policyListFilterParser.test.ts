import { describe, expect, it } from 'vitest';
import { buildPolicyListWhereFromQuery } from '../policyListFilterParser.js';
import { getPolicyListRegistry } from '../policyListRegistry.js';

describe('policyListFilterParser', () => {
  it('parses boolean and enum filters via registry', () => {
    const registry = getPolicyListRegistry();
    const { whereClauses, errors } = buildPolicyListWhereFromQuery(
      {
        'f.status.eq': 'ACTIVE',
        'f.invoiceOverdue.eq': 'true',
        'f.needsAttention.eq': 'yes',
      },
      registry
    );

    expect(whereClauses).toEqual(
      expect.arrayContaining([
        { status: 'ACTIVE' },
        { invoiceOverdue: true },
        { attentionScore: { gte: 80 } },
      ])
    );
    expect(errors).toEqual([]);
  });

  it('parses numeric and date operators', () => {
    const registry = getPolicyListRegistry();
    const { whereClauses, errors } = buildPolicyListWhereFromQuery(
      {
        'f.outstandingBalance.gte': '100',
        'f.expiryDate.between': '2026-01-01,2026-12-31',
      },
      registry
    );

    expect(whereClauses).toEqual(
      expect.arrayContaining([
        { outstandingBalance: { gte: 100 } },
        {
          policy: {
            expiryDate: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-12-31'),
            },
          },
        },
      ])
    );
    expect(errors).toEqual([]);
  });

  it('returns strict errors for unknown fields/operators', () => {
    const registry = getPolicyListRegistry();
    const parsed = buildPolicyListWhereFromQuery(
      {
        'f.badField.eq': '1',
        'f.status.badOp': 'ACTIVE',
      },
      registry
    );
    expect(parsed.whereClauses).toEqual([]);
    expect(parsed.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(['UNKNOWN_FILTER_FIELD', 'UNKNOWN_FILTER_OPERATOR'])
    );
  });

  it('enforces caps for in-list length', () => {
    const registry = getPolicyListRegistry();
    const tooMany = Array.from({ length: 55 }, (_, i) => `S${i}`).join(',');
    const parsed = buildPolicyListWhereFromQuery(
      {
        'f.status.in': tooMany,
      },
      registry
    );
    expect(parsed.errors.map((e) => e.code)).toContain('IN_LIST_TOO_LONG');
  });

  it('normalizes registry urlKey aliases before applying filters', () => {
    const registry = getPolicyListRegistry();
    const { whereClauses, errors, parsed } = buildPolicyListWhereFromQuery(
      {
        program_id: '33333333-3333-4333-8333-333333333333',
        binder_id: 'TRAVEL-25EEA6153',
      },
      registry
    );

    expect(whereClauses).toEqual(
      expect.arrayContaining([
        { policy: { programId: '33333333-3333-4333-8333-333333333333' } },
        { policy: { binderId: 'TRAVEL-25EEA6153' } },
      ])
    );
    expect(parsed).toEqual(
      expect.arrayContaining([
        { key: 'program', op: 'eq' },
        { key: 'binder', op: 'eq' },
      ])
    );
    expect(errors).toEqual([]);
  });

  it('parses program in-filters for grouped program options', () => {
    const registry = getPolicyListRegistry();
    const { whereClauses, errors, parsed } = buildPolicyListWhereFromQuery(
      {
        'f.program.in': 'travel-old,travel-new',
      },
      registry
    );

    expect(whereClauses).toEqual(
      expect.arrayContaining([
        { policy: { programId: { in: ['travel-old', 'travel-new'] } } },
      ])
    );
    expect(parsed).toEqual(expect.arrayContaining([{ key: 'program', op: 'in' }]));
    expect(errors).toEqual([]);
  });
});

