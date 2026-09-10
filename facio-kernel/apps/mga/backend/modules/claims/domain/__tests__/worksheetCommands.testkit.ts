import { vi } from 'vitest';

export const mockBuildClaimWorksheetProjection = vi.fn();
export const mockPersistClaimProjectionSnapshot = vi.fn();
export const mockAppendDomainEvent = vi.fn();
export const mockBuildDomainEvent = vi.fn((value: unknown) => value);

export const mockTx = {
  claimEvent: {
    findFirst: vi.fn(async () => ({ aggregateVersion: 1 })),
    create: vi.fn(async (args: unknown) => ({ id: 'ev-1', ...(args as { data?: Record<string, unknown> })?.data })),
  },
  claim: {
    findUnique: vi.fn(async () => ({
      id: 'claim-1',
      policyId: 'policy-1',
      claimNumber: 'CLM-1',
      data: { cr0029_certificate_reference: 'CERT-1', openDiaryTasks: 0, pendingFinancialItems: 0, litigationFlag: false },
      events: [],
      policy: null,
      assignments: [],
    })),
    update: vi.fn(async () => ({})),
  },
  policy: {
    findUnique: vi.fn(async () => ({ id: 'policy-1', quoteData: { deductible: 300 } })),
  },
  claimCounterparty: {
    upsert: vi.fn(async (args: unknown) => {
      const data = (args as { create?: Record<string, unknown>; update?: Record<string, unknown> }).create
        || (args as { update?: Record<string, unknown> }).update
        || {};
      return {
        id: String((data.id as string | undefined) || 'cp-1'),
        claimId: 'claim-1',
        slug: String((data.slug as string | undefined) || 'default:claimant'),
        name: String((data.name as string | undefined) || 'Claimant'),
        entityType: String((data.entityType as string | undefined) || 'person'),
        roles: Array.isArray(data.roles) ? data.roles : ['claimant'],
        status: 'ACTIVE',
        providerType: data.providerType || null,
        sourceType: data.sourceType || 'SYSTEM_DEFAULT',
      };
    }),
    updateMany: vi.fn(async () => ({ count: 0 })),
    findMany: vi.fn(async () => [{
      id: 'cp-1',
      claimId: 'claim-1',
      slug: 'default:claimant',
      name: 'Claimant',
      entityType: 'person',
      roles: ['claimant'],
      status: 'ACTIVE',
      providerType: null,
      sourceType: 'SYSTEM_DEFAULT',
    }]),
    findFirst: vi.fn(async () => ({
      id: 'cp-1',
      claimId: 'claim-1',
      slug: 'default:claimant',
      name: 'Claimant',
      entityType: 'person',
      roles: ['claimant'],
      status: 'ACTIVE',
      providerType: null,
    })),
  },
  claimProjectionSnapshot: {
    create: vi.fn(async () => ({})),
  },
};

vi.mock('../../../../platform/db/connection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../platform/db/connection.js')>();
  const mockPrisma = {
    ...actual.prisma,
    $transaction: vi.fn(async (callback: (tx: typeof mockTx) => unknown) => callback(mockTx)),
  };
  return {
    ...actual,
    prisma: mockPrisma,
    tenantScopedPrisma: {
      ...actual.tenantScopedPrisma,
      $transaction: mockPrisma.$transaction,
    },
  };
});

vi.mock('../worksheetProjection.js', () => ({
  buildClaimWorksheetProjection: (...args: unknown[]) => mockBuildClaimWorksheetProjection(...args),
  persistClaimProjectionSnapshot: (...args: unknown[]) => mockPersistClaimProjectionSnapshot(...args),
}));

vi.mock('../../../../platform/events/domainEvents.js', () => ({
  appendDomainEvent: (...args: unknown[]) => mockAppendDomainEvent(...args),
  buildDomainEvent: (...args: unknown[]) => mockBuildDomainEvent(...args),
}));

export async function runCommand(args: {
  claimId: string;
  type: string;
  payload: Record<string, unknown>;
  input: { actorType: 'USER' | 'SYSTEM' | 'CUSTOMER' | 'UNDERWRITER' | 'OPS'; actorId: string; actorName?: string };
}) {
  const mod = await import('../worksheetCommands.js');
  return mod.executeClaimWorksheetCommand(args as never);
}

export const baseProjection = () => ({
  referredToUw: false,
  denied: false,
  clarificationOpen: false,
  amendments: [],
  referralRequired: false,
  largeLossIndicator: false,
  largeLossNotifiedAt: undefined,
  referralApprovedAt: undefined,
  buckets: {
    INDEMNITY: { paid: 0, outstanding: 500, recovered: 0, recoveryExpected: 0, salvageRealized: 0, salvageExpected: 0 },
    DEFENCE_COSTS: { paid: 0, outstanding: 0, recovered: 0, recoveryExpected: 0, salvageRealized: 0, salvageExpected: 0 },
    ADJUSTER_FEES: { paid: 0, outstanding: 0, recovered: 0, recoveryExpected: 0, salvageRealized: 0, salvageExpected: 0 },
    LEGAL_FEES: { paid: 0, outstanding: 0, recovered: 0, recoveryExpected: 0, salvageRealized: 0, salvageExpected: 0 },
    OTHER: { paid: 0, outstanding: 0, recovered: 0, recoveryExpected: 0, salvageRealized: 0, salvageExpected: 0 },
  },
  paidIndemnity: 0,
  paidFees: 0,
  reserveIndemnity: 500,
  reserveFees: 0,
  recoveriesReceived: 0,
  recoveriesExpected: 0,
  salvageRealized: 0,
  salvageExpected: 0,
  totalPaid: 0,
  totalOutstanding: 500,
  totalIncurred: 500,
  totalRecovered: 0,
  netIncurred: 500,
  claimId: 'claim-1',
  claimReference: 'CLM-1',
  certificateReference: 'CERT-1',
  status: 'OPEN',
  cr0106ReferredToUnderwriters: 'N',
  cr0107Denial: 'N',
  totalIncurredIndemnity: 500,
  totalIncurredFees: 0,
  totalIncurredOverall: 500,
  phase: 'INVESTIGATION',
  intake: {
    status: 'FNOL_CONFIRMED',
    currentVersion: 1,
    confirmedVersion: 1,
    fnol: { incident: { type: 'collision', date: '2026-03-01', location: { address: 'Nicosia' }, description: 'Valid narrative for gate' } },
    submittedAt: '2026-03-01T00:00:00.000Z',
    submittedBy: { actorType: 'USER', actorId: 'u1', actorName: 'Tester' },
    confirmedAt: '2026-03-01T00:05:00.000Z',
    confirmedBy: { actorType: 'USER', actorId: 'u1', actorName: 'Tester' },
    clarificationOpen: false,
    amendments: [],
    gates: [
      { key: 'lossTypePresent', label: 'Loss type present', status: 'PASS' },
      { key: 'dateOfLossPresent', label: 'Date of loss present', status: 'PASS' },
      { key: 'locationPresent', label: 'Location present', status: 'PASS' },
      { key: 'narrativePresent', label: 'Narrative present', status: 'PASS' },
      { key: 'fnolConfirmed', label: 'FNOL confirmed', status: 'PASS' },
    ],
    requiredActions: [],
  },
  timeline: [],
});

export function resetCommandTestState() {
  vi.clearAllMocks();
  mockBuildClaimWorksheetProjection.mockReturnValue(baseProjection());
}

