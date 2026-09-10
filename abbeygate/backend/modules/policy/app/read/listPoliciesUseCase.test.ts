import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { ListPoliciesUseCaseDeps } from './listPoliciesUseCase.js';
import { listPoliciesUseCase } from './listPoliciesUseCase.js';

function makeDeps(overrides?: Partial<ListPoliciesUseCaseDeps>): ListPoliciesUseCaseDeps {
  const base: ListPoliciesUseCaseDeps = {
    helpers: {
      parseRecord(value: unknown) {
        return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
      },
      normalizeSortRules() {
        return [{ field: 'updatedAt', direction: 'desc' }];
      },
      buildOrderBy() {
        return [{ updatedAt: 'desc' }];
      },
      buildPolicySearchOrClauses() {
        return [];
      },
      listFiltersFromQuery() {
        return {};
      },
      shortHash() {
        return 'abc123';
      },
      decodeCursor() {
        return null;
      },
      encodeCursor() {
        return 'cursor';
      },
      policySortType() {
        return 'string';
      },
      normalizeCursorValue(_type, raw) {
        return raw;
      },
      eqClause() {
        return {};
      },
      cmpClause() {
        return {};
      },
      valueFromPolicy() {
        return null;
      },
      readHotViewCache() {
        return null;
      },
      setHotViewCache() {
        return;
      },
      hotViewCacheHitRatePct() {
        return 0;
      },
      readIndexCoverageCache() {
        return null;
      },
      setIndexCoverageCache() {
        return;
      },
      stripVehicleSearchFromWhere(input) {
        return input;
      },
      isVehicleSearchUnknownArgError() {
        return false;
      },
      USE_POLICY_STATE: false,
    },
    filtering: {
      buildPolicyListWhereFromQuery() {
        return { errors: [], whereClauses: [] };
      },
    },
    repo: {
      async findPolicyListIndexRows() {
        return [
          {
            policyId: 'pol_1',
            policyNumber: 'ABV1',
            insuredName: 'Ada',
            status: 'ACTIVE',
            updatedAt: '2026-01-01T00:00:00.000Z',
            policy: {
              createdAt: '2026-01-01T00:00:00.000Z',
              inceptionDate: '2026-01-01',
              expiryDate: '2027-01-01',
              productType: 'MOTOR',
              paymentStatus: 'PENDING',
            },
          },
        ];
      },
      async countPolicyListIndex() {
        return 1;
      },
      async countPoliciesAutoInsurance() {
        return 1;
      },
    },
    logger: {
      info() {
        return;
      },
      warn() {
        return;
      },
    },
  };
  return {
    ...base,
    ...overrides,
    helpers: { ...base.helpers, ...(overrides?.helpers || {}) },
    filtering: { ...base.filtering, ...(overrides?.filtering || {}) },
    repo: { ...base.repo, ...(overrides?.repo || {}) },
    logger: { ...base.logger, ...(overrides?.logger || {}) },
  };
}

describe('listPoliciesUseCase', () => {
  it('returns INVALID_FILTER_QUERY payload unchanged', async () => {
    const result = await listPoliciesUseCase(
      {
        query: {},
        actor: { role: 'BROKER' },
        startedAtMs: Date.now(),
      },
      makeDeps({
        filtering: {
          buildPolicyListWhereFromQuery() {
            return { errors: [{ field: 'x', reason: 'bad' }], whereClauses: [] };
          },
        },
      })
    );
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      success: false,
      error: {
        code: 'INVALID_FILTER_QUERY',
        message: 'One or more filters are invalid for the current policies list registry.',
        details: [{ field: 'x', reason: 'bad' }],
      },
    });
  });

  it('returns paged success payload shape', async () => {
    const result = await listPoliciesUseCase(
      {
        query: { page: '1', pageSize: '100' },
        actor: { role: 'BROKER' },
        startedAtMs: Date.now(),
      },
      makeDeps()
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      success: true,
      data: [
        {
          policyId: 'pol_1',
          policyNumber: 'ABV1',
          paymentStatus: 'PENDING',
        },
      ],
      pagination: {
        page: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1,
      },
    });
  });

  it('skips index-coverage counts on default (non-debug) requests', async () => {
    let unfilteredIndexCalls = 0;
    let autoInsuranceCalls = 0;
    const result = await listPoliciesUseCase(
      {
        query: { paging: 'cursor', limit: '25' },
        actor: { role: 'BROKER' },
        startedAtMs: Date.now(),
        tenantId: 't_1',
      },
      makeDeps({
        repo: {
          async findPolicyListIndexRows() {
            return [];
          },
          async countPolicyListIndex(where) {
            if (typeof where === 'undefined') unfilteredIndexCalls += 1;
            return 0;
          },
          async countPoliciesAutoInsurance() {
            autoInsuranceCalls += 1;
            return 0;
          },
        },
      }),
    );

    expect(result.status).toBe(200);
    expect(unfilteredIndexCalls).toBe(0);
    expect(autoInsuranceCalls).toBe(0);
    const meta = (result.body as { meta?: Record<string, unknown> }).meta || {};
    expect(meta).not.toHaveProperty('indexCoveragePct');
    expect(meta).not.toHaveProperty('partialResults');
    expect(meta).toHaveProperty('cacheHit');
  });

  it('returns indexCoveragePct meta when ?debug=1 is set', async () => {
    let unfilteredIndexCalls = 0;
    let autoInsuranceCalls = 0;
    const result = await listPoliciesUseCase(
      {
        query: { paging: 'cursor', limit: '25', debug: '1' },
        actor: { role: 'BROKER' },
        startedAtMs: Date.now(),
        tenantId: 't_1',
      },
      makeDeps({
        repo: {
          async findPolicyListIndexRows() {
            return [];
          },
          async countPolicyListIndex(where) {
            if (typeof where === 'undefined') unfilteredIndexCalls += 1;
            return 8;
          },
          async countPoliciesAutoInsurance() {
            autoInsuranceCalls += 1;
            return 10;
          },
        },
      }),
    );

    expect(result.status).toBe(200);
    expect(unfilteredIndexCalls).toBe(1);
    expect(autoInsuranceCalls).toBe(1);
    const meta = (result.body as { meta?: Record<string, unknown> }).meta || {};
    expect(meta.indexCoveragePct).toBe(80);
    expect(meta.partialResults).toBe(true);
  });

  it('serves index-coverage from per-tenant cache on a second ?debug=1 hit', async () => {
    let unfilteredIndexCalls = 0;
    let autoInsuranceCalls = 0;
    let cached: { indexedPolicies: number; totalPolicies: number } | null = null;
    const deps = makeDeps({
      helpers: {
        readIndexCoverageCache(tenantId: string) {
          return tenantId === 't_cached' ? cached : null;
        },
        setIndexCoverageCache(tenantId: string, payload) {
          if (tenantId === 't_cached') cached = payload;
        },
      },
      repo: {
        async findPolicyListIndexRows() {
          return [];
        },
        async countPolicyListIndex(where) {
          if (typeof where === 'undefined') unfilteredIndexCalls += 1;
          return 50;
        },
        async countPoliciesAutoInsurance() {
          autoInsuranceCalls += 1;
          return 100;
        },
      },
    });

    const first = await listPoliciesUseCase(
      {
        query: { paging: 'cursor', limit: '25', debug: '1' },
        actor: { role: 'BROKER' },
        startedAtMs: Date.now(),
        tenantId: 't_cached',
      },
      deps,
    );
    const second = await listPoliciesUseCase(
      {
        query: { paging: 'cursor', limit: '25', debug: '1' },
        actor: { role: 'BROKER' },
        startedAtMs: Date.now(),
        tenantId: 't_cached',
      },
      deps,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(unfilteredIndexCalls).toBe(1);
    expect(autoInsuranceCalls).toBe(1);
    const firstMeta = (first.body as { meta?: Record<string, unknown> }).meta || {};
    const secondMeta = (second.body as { meta?: Record<string, unknown> }).meta || {};
    expect(firstMeta.indexCoveragePct).toBe(50);
    expect(secondMeta.indexCoveragePct).toBe(50);
  });

  it('maps compact rows from index display fields without policy join', async () => {
    const result = await listPoliciesUseCase(
      {
        query: { paging: 'cursor', limit: '12', includeTotal: '1' },
        actor: { role: 'ADMIN' },
        startedAtMs: Date.now(),
      },
      makeDeps({
        repo: {
          async findPolicyListIndexRows() {
            return [
              {
                policyId: 'pol_fresh',
                policyNumber: 'ABQ9999',
                status: 'DRAFT',
                updatedAt: '2026-01-01T00:00:00.000Z',
                insuredName: 'Fresh Quote',
                insuredDisplay: 'Fresh Quote',
                vehicleDisplay: '2024 Tesla Model Y',
                policyholderDisplay: 'Fresh Quote',
                policyholderEmail: 'fresh@example.com',
                policyholderPhone: '+35799111222',
                coverageStart: '2026-01-01',
                coverageEnd: '2027-01-01',
              },
            ];
          },
          async countPolicyListIndex(where) {
            if (where) return 1;
            return 1;
          },
          async countPoliciesAutoInsurance() {
            return 1;
          },
        },
      }),
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      success: true,
      data: [
        {
          policyId: 'pol_fresh',
          policyNumber: 'ABQ9999',
          insuredDisplay: 'Fresh Quote',
          vehicleDisplay: '2024 Tesla Model Y',
          policyholderEmail: 'fresh@example.com',
        },
      ],
    });
  });

  it('excludes empty leads from the BO list by default', async () => {
    let capturedWhere: Prisma.PolicyListIndexWhereInput | undefined;
    await listPoliciesUseCase(
      {
        query: { page: '1', pageSize: '100' },
        actor: { role: 'BROKER' },
        startedAtMs: Date.now(),
      },
      makeDeps({
        repo: {
          async findPolicyListIndexRows(args) {
            capturedWhere = args.where;
            return [];
          },
          async countPolicyListIndex() {
            return 0;
          },
          async countPoliciesAutoInsurance() {
            return 0;
          },
        },
      }),
    );

    const serialized = JSON.stringify(capturedWhere ?? {});
    expect(serialized).toContain('"NOT"');
    expect(serialized).toContain('DRAFT');
    expect(serialized).toContain('INTAKE');
  });

  it('surfaces empty leads when includeEmptyLeads=true', async () => {
    let capturedWhere: Prisma.PolicyListIndexWhereInput | undefined;
    await listPoliciesUseCase(
      {
        query: { page: '1', pageSize: '100', includeEmptyLeads: 'true' },
        actor: { role: 'BROKER' },
        startedAtMs: Date.now(),
      },
      makeDeps({
        repo: {
          async findPolicyListIndexRows(args) {
            capturedWhere = args.where;
            return [];
          },
          async countPolicyListIndex() {
            return 0;
          },
          async countPoliciesAutoInsurance() {
            return 0;
          },
        },
      }),
    );

    const serialized = JSON.stringify(capturedWhere ?? {});
    expect(serialized).not.toContain('"NOT"');
  });

  it('projects compact referral summaries from underwriting analysis', async () => {
    const result = await listPoliciesUseCase(
      {
        query: { paging: 'cursor', limit: '12', projection: 'compact' },
        actor: { role: 'ADMIN' },
        startedAtMs: Date.now(),
      },
      makeDeps({
        repo: {
          async findPolicyListIndexRows() {
            return [
              {
                policyId: 'pol_referral',
                policyNumber: 'ABQ-REF',
                status: 'REFERRAL',
                bo_status: 'REFERRAL',
                updatedAt: '2026-01-01T00:00:00.000Z',
                insuredName: 'Referral Risk',
                uwActionRequired: true,
                policy: {
                  productType: 'HOME',
                  publicSessionToken: 'tok_ref',
                  quoteData: {
                    property: {
                      address: { country: 'Spain' },
                    },
                  },
                  stateCurrent: {
                    snapshot: {
                      underwritingAnalysis: {
                        lane: 'yellow',
                        outcome: 'referral',
                        triggerCount: 1,
                        triggers: [
                          {
                            code: 'HOME_COUNTRY_REFERRAL',
                            message: 'Property country requires review',
                            explanation: 'The selected territory is outside straight-through appetite.',
                            fields: ['property.address.country'],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            ];
          },
          async countPolicyListIndex() {
            return 1;
          },
          async countPoliciesAutoInsurance() {
            return 1;
          },
        },
      }),
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      success: true,
      data: [
        {
          policyId: 'pol_referral',
          referralSummary: {
            outcome: 'referral',
            lane: 'yellow',
            reason: 'Property country requires review',
            fields: [
              {
                key: 'property.address.country',
                answer: 'Spain',
              },
            ],
            clientLink: '/quote/tok_ref?product=home',
          },
        },
      ],
    });
  });
});
