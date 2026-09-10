import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, tenantScopedPrisma } = vi.hoisted(() => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
  },
  tenantScopedPrisma: {
    policyListIndex: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      count: vi.fn(),
    },
    auditAction: {
      findMany: vi.fn(),
    },
    officeStaffTarget: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    policy: {
      findUnique: vi.fn(),
    },
    policyAssignment: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../../../../platform/db/connection.js', () => ({ prisma, tenantScopedPrisma }));

import {
  assignPolicyToStaff,
  getAuditReport,
  getCashSheetReport,
  getDebtorsReport,
  getOfficeTargetReport,
  PolicyAssignmentTargetMissingError,
  PolicyAssignmentStaffTargetInvalidError,
  rowsToReportCsv,
} from '../boOperationalReports.js';

describe('boOperationalReports', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
    tenantScopedPrisma.policyListIndex.findMany.mockReset();
    tenantScopedPrisma.policyListIndex.aggregate.mockReset();
    tenantScopedPrisma.policyListIndex.count.mockReset();
    tenantScopedPrisma.auditAction.findMany.mockReset();
    tenantScopedPrisma.officeStaffTarget.findMany.mockReset();
    tenantScopedPrisma.officeStaffTarget.findFirst.mockReset();
    tenantScopedPrisma.officeStaffTarget.create.mockReset();
    tenantScopedPrisma.officeStaffTarget.update.mockReset();
    tenantScopedPrisma.policy.findUnique.mockReset();
    tenantScopedPrisma.policyAssignment.upsert.mockReset();
    prisma.user.findFirst.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds Cash Sheet rows and totals from PolicyListIndex', async () => {
    tenantScopedPrisma.policyListIndex.findMany.mockResolvedValueOnce([
      {
        policyId: 'pol_1',
        policyNumber: 'ABV/CY000001',
        insuredName: 'Ada Driver',
        status: 'ISSUED',
        bo_status: 'ISSUED',
        operatingTenantId: 'tenant_cy',
        coverageStart: new Date('2026-07-01T00:00:00.000Z'),
        coverageEnd: new Date('2027-07-01T00:00:00.000Z'),
        totalPremium: '120.50',
        outstandingBalance: '20.25',
        invoiceOverdue: true,
        policy: {
          productType: 'MOTOR',
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
          inceptionDate: new Date('2026-07-10T00:00:00.000Z'),
          issuedAt: new Date('2026-07-11T00:00:00.000Z'),
        },
      },
    ]);
    tenantScopedPrisma.policyListIndex.aggregate.mockResolvedValueOnce({
      _count: { policyId: 1 },
      _sum: { totalPremium: '120.50', outstandingBalance: '20.25' },
    });
    tenantScopedPrisma.policyListIndex.count.mockResolvedValueOnce(1);

    const result = await getCashSheetReport({
      dateBasis: 'inceptionDate',
      start: new Date('2026-07-01T00:00:00.000Z'),
      end: new Date('2026-07-31T23:59:59.999Z'),
      productType: 'MOTOR',
      operatingTenantId: 'tenant_cy',
    });

    expect(result.totals).toEqual({
      count: 1,
      totalPremium: 120.5,
      outstandingBalance: 20.25,
      invoiceOverdueCount: 1,
    });
    expect(result.items[0]).toMatchObject({
      policyNumber: 'ABV/CY000001',
      insuredName: 'Ada Driver',
      productType: 'MOTOR',
      status: 'ISSUED',
      boStatus: 'ACTIVE',
      date: '2026-07-10T00:00:00.000Z',
    });
    expect(tenantScopedPrisma.policyListIndex.findMany.mock.calls[0]?.[0]?.where).toMatchObject({
      operatingTenantId: 'tenant_cy',
      policy: {
        productType: 'MOTOR',
        inceptionDate: {
          gte: new Date('2026-07-01T00:00:00.000Z'),
          lte: new Date('2026-07-31T23:59:59.999Z'),
        },
      },
    });
  });

  it('keeps pre-inception ISSUED policies labelled ISSUED on Cash Sheet (ABY-459)', async () => {
    tenantScopedPrisma.policyListIndex.findMany.mockResolvedValueOnce([
      {
        policyId: 'pol_future',
        policyNumber: 'ABV/CY000002',
        insuredName: 'Future Driver',
        status: 'ISSUED',
        bo_status: 'ISSUED',
        operatingTenantId: 'tenant_cy',
        coverageStart: new Date('2026-12-01T00:00:00.000Z'),
        coverageEnd: new Date('2027-12-01T00:00:00.000Z'),
        totalPremium: '200.00',
        outstandingBalance: '0',
        invoiceOverdue: false,
        policy: {
          productType: 'MOTOR',
          createdAt: new Date('2026-11-01T00:00:00.000Z'),
          inceptionDate: new Date('2026-12-01T00:00:00.000Z'),
          issuedAt: new Date('2026-11-15T00:00:00.000Z'),
        },
      },
    ]);
    tenantScopedPrisma.policyListIndex.aggregate.mockResolvedValueOnce({
      _count: { policyId: 1 },
      _sum: { totalPremium: '200.00', outstandingBalance: '0' },
    });
    tenantScopedPrisma.policyListIndex.count.mockResolvedValueOnce(0);

    const result = await getCashSheetReport({ dateBasis: 'inceptionDate' });

    expect(result.items[0]?.boStatus).toBe('ISSUED');
  });

  it('restricts Debtors to outstanding or overdue rows', async () => {
    tenantScopedPrisma.policyListIndex.findMany.mockResolvedValueOnce([]);
    tenantScopedPrisma.policyListIndex.aggregate.mockResolvedValueOnce({
      _count: { policyId: 0 },
      _sum: { totalPremium: null, outstandingBalance: null },
    });
    tenantScopedPrisma.policyListIndex.count.mockResolvedValueOnce(0);

    await getDebtorsReport({ dateBasis: 'createdAt' });

    expect(tenantScopedPrisma.policyListIndex.findMany.mock.calls[0]?.[0]?.where).toMatchObject({
      OR: [
        { outstandingBalance: { gt: 0 } },
        { invoiceOverdue: true },
      ],
    });
  });

  it('derives changed/result fields for Activity Log rows', async () => {
    tenantScopedPrisma.auditAction.findMany.mockResolvedValueOnce([
      {
        id: 'audit_1',
        occurredAt: new Date('2026-07-02T10:30:00.000Z'),
        actorId: 'user_1',
        actorName: 'Peter',
        actorType: 'ADMIN',
        actionName: 'POLICY.UPDATED',
        entityType: 'POLICY',
        entityId: 'pol_1',
        diff: { before: { status: 'QUOTED' }, after: { status: 'ACTIVE' }, result: 'ACTIVE' },
      },
    ]);

    const result = await getAuditReport({ entityType: 'POLICY', changedOnly: true });

    expect(result.items).toEqual([
      {
        id: 'audit_1',
        occurredAt: '2026-07-02T10:30:00.000Z',
        actorId: 'user_1',
        actorName: 'Peter',
        actorType: 'ADMIN',
        actionName: 'POLICY.UPDATED',
        entityType: 'POLICY',
        entityId: 'pol_1',
        changed: true,
        result: 'ACTIVE',
      },
    ]);
  });

  it('keeps View Tracks separate by returning only view/read audit actions', async () => {
    tenantScopedPrisma.auditAction.findMany.mockResolvedValueOnce([
      {
        id: 'view_1',
        occurredAt: new Date('2026-07-02T10:30:00.000Z'),
        actorId: 'user_1',
        actorName: null,
        actorType: 'ADMIN',
        actionName: 'POLICY.VIEWED',
        entityType: 'POLICY',
        entityId: 'pol_1',
        diff: null,
      },
      {
        id: 'edit_1',
        occurredAt: new Date('2026-07-02T10:31:00.000Z'),
        actorId: 'user_1',
        actorName: null,
        actorType: 'ADMIN',
        actionName: 'POLICY.UPDATED',
        entityType: 'POLICY',
        entityId: 'pol_1',
        diff: { after: { status: 'ACTIVE' } },
      },
    ]);

    const result = await getAuditReport({ viewOnly: true });

    expect(result.items.map((row) => row.id)).toEqual(['view_1']);
  });

  it('serializes report CSV with stable headers', () => {
    expect(rowsToReportCsv([{ policyNumber: 'ABV/1', insuredName: 'A, B' }], ['policyNumber', 'insuredName']))
      .toBe('policyNumber,insuredName\nABV/1,"A, B"');
  });

  it('builds office target rows for new business, renewal, and total', async () => {
    tenantScopedPrisma.officeStaffTarget.findMany.mockResolvedValueOnce([
      {
        id: 'target_nb',
        scope: 'OFFICE',
        businessCategory: 'NEW_BUSINESS',
        userId: null,
        productCode: 'MOTOR',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T00:00:00.000Z'),
        premiumTarget: 600,
        policyCountTarget: 3,
        conversionTarget: null,
      },
      {
        id: 'target_rnl',
        scope: 'OFFICE',
        businessCategory: 'RENEWAL',
        userId: null,
        productCode: 'MOTOR',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T00:00:00.000Z'),
        premiumTarget: 400,
        policyCountTarget: 2,
        conversionTarget: null,
      },
    ]);
    tenantScopedPrisma.policyListIndex.aggregate.mockImplementation(async (args: { where?: { policy?: { priorTermPolicyId?: unknown } } }) => {
      const renewalFilter = args?.where?.policy?.priorTermPolicyId;
      if (renewalFilter === null) {
        return { _count: { policyId: 2 }, _sum: { totalPremium: 500 } };
      }
      if (renewalFilter && typeof renewalFilter === 'object' && 'not' in renewalFilter) {
        return { _count: { policyId: 2 }, _sum: { totalPremium: 400 } };
      }
      return { _count: { policyId: 4 }, _sum: { totalPremium: 900 } };
    });

    const report = await getOfficeTargetReport({ dateBasis: 'createdAt' });

    expect(report.actuals).toEqual({
      premium: 900,
      policyCount: 4,
      newBusinessPremium: 500,
      renewalPremium: 400,
      newBusinessPolicyCount: 2,
      renewalPolicyCount: 2,
    });
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.categories).toEqual([
      expect.objectContaining({
        category: 'NEW_BUSINESS',
        premiumTarget: 600,
        premiumActual: 500,
        premiumVariance: -100,
        policyCountTarget: 3,
        policyCountActual: 2,
        policyCountVariance: -1,
      }),
      expect.objectContaining({
        category: 'RENEWAL',
        premiumTarget: 400,
        premiumActual: 400,
        premiumVariance: 0,
      }),
      expect.objectContaining({
        category: 'TOTAL',
        premiumTarget: 1000,
        premiumActual: 900,
        premiumVariance: -100,
        policyCountTarget: 5,
        policyCountActual: 4,
        policyCountVariance: -1,
      }),
    ]);
    const aggregateCalls = tenantScopedPrisma.policyListIndex.aggregate.mock.calls.map((call) => call[0]);
    expect(aggregateCalls.some((call) => call?.where?.policy?.priorTermPolicyId === null)).toBe(true);
    expect(aggregateCalls.some((call) => call?.where?.policy?.priorTermPolicyId?.not === null)).toBe(true);
  });

  it('refuses staff assignment when the policy does not exist (ABY-451 / ABBEYGATE-1Y)', async () => {
    tenantScopedPrisma.policy.findUnique.mockResolvedValueOnce(null);

    await expect(assignPolicyToStaff({
      policyId: 'missing-policy',
      assignedToUserId: 'user_1',
    })).rejects.toBeInstanceOf(PolicyAssignmentTargetMissingError);
    expect(tenantScopedPrisma.policyAssignment.upsert).not.toHaveBeenCalled();
  });

  it('upserts a staff assignment only after the policy is found', async () => {
    tenantScopedPrisma.policy.findUnique.mockResolvedValueOnce({ id: 'pol_1' });
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'user_1' });
    tenantScopedPrisma.policyAssignment.upsert.mockResolvedValueOnce({ id: 'assign_1' });

    const result = await assignPolicyToStaff({
      policyId: 'pol_1',
      assignedToUserId: 'user_1',
      assignedByUserId: 'admin_1',
    });

    expect(result).toEqual({ id: 'assign_1' });
    expect(tenantScopedPrisma.policy.findUnique).toHaveBeenCalledWith({
      where: { id: 'pol_1' },
      select: { id: true },
    });
    expect(tenantScopedPrisma.policyAssignment.upsert).toHaveBeenCalledTimes(1);
  });

  it('refuses assignment to a user who is not active internal staff', async () => {
    tenantScopedPrisma.policy.findUnique.mockResolvedValueOnce({ id: 'pol_1' });
    prisma.user.findFirst.mockResolvedValueOnce(null);

    await expect(assignPolicyToStaff({
      policyId: 'pol_1',
      assignedToUserId: 'customer-or-missing-user',
    })).rejects.toBeInstanceOf(PolicyAssignmentStaffTargetInvalidError);
    expect(tenantScopedPrisma.policyAssignment.upsert).not.toHaveBeenCalled();
  });
});
