import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { PolicyForDocPack } from '../../../shared/documents/genericDocPackGenerator.js';
import { executeTravelDocPackGeneration } from '../generateTravelDocPack.js';

type GeneratedDocument = Awaited<ReturnType<typeof executeTravelDocPackGeneration>>['documents'][number];
type PolicyFixture = PolicyForDocPack & { quoteData: Prisma.JsonValue; binder: { umr: string } | null };
type BoundRiskFixture = { snapshotFinal: Prisma.JsonValue };

const mocks = vi.hoisted(() => ({
  upload: vi.fn<(bytes: Buffer, filename: string) => Promise<{ url: string }>>(),
  policy: vi.fn<() => Promise<PolicyFixture | null>>(),
  boundRisk: vi.fn<() => Promise<BoundRiskFixture | null>>(),
  findDocument: vi.fn<(args: Prisma.DocumentFindFirstArgs) => Promise<GeneratedDocument | null>>(),
  createDocument: vi.fn<(args: { data: Omit<GeneratedDocument, 'id'> }) => Promise<GeneratedDocument>>(),
  updateDocuments: vi.fn(),
}));
vi.mock('../../../../platform/db/connection.js', () => {
  const db = {
    policy: { findUnique: mocks.policy },
    riskTransaction: { findUnique: mocks.boundRisk },
    document: { findFirst: mocks.findDocument, create: mocks.createDocument, updateMany: mocks.updateDocuments },
  };
  return { prisma: db, tenantScopedPrisma: db };
});
vi.mock('../../../../platform/storage/service.js', () => ({ storageService: { uploadFile: mocks.upload } }));
vi.mock('../../../../modules/documents/app/pdfRenderer.js', () => ({ renderHtmlToPdf: async () => Buffer.from('%PDF-generated-template') }));
vi.mock('../viewModel.js', () => ({ buildTravelDocViewModel: () => ({}) }));

function prepareIssuedPolicy(planType: 'single_trip' | 'annual_multi_trip', existingIpid?: GeneratedDocument) {
  mocks.policy.mockResolvedValue({
    id: 'travel-issued', policyNumber: 'TRAVEL-1', productType: 'TRAVEL',
    certificateNumber: null, inceptionDate: null, expiryDate: null, umr: null,
    binderId: null, binder: null, policyHolder: null,
    quoteData: { trip: { planType: 'single_trip' } },
  });
  mocks.boundRisk.mockResolvedValue({ snapshotFinal: { quoteData: { trip: { planType } } } });
  mocks.findDocument.mockImplementation(async ({ where }) => where?.type === 'TRAVEL_IPID_PDF' ? existingIpid ?? null : null);
  mocks.createDocument.mockImplementation(async ({ data }) => ({ id: `doc-${data.type}`, ...data }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockImplementation(async (_bytes, filename) => ({ url: `https://files.example/${filename}` }));
});

describe('issued Travel IPID evidence', () => {
  it('persists the Annual original selected by the bound snapshot even when mutable policy data says Single-Trip', async () => {
    prepareIssuedPolicy('annual_multi_trip');
    const result = await executeTravelDocPackGeneration({ policyId: 'travel-issued', riskTransactionId: 'bound-risk', docPack: 'ISSUED_POLICY_PACK', source: 'SYSTEM' });
    const ipid = result.documents.find((doc) => doc.type === 'TRAVEL_IPID_PDF');
    expect(ipid).toMatchObject({ filename: 'Travel_Annual_Multi_Trip_IPID.pdf', fileHash: '2378c1cc71b86cce2ea291f3292fce81a5bbdabad10eb0d82ca2f53908c23688', riskTransactionId: 'bound-risk' });
    expect(ipid?.templateVersion).toContain('brit-travel-annual-multitrip-ipid:2025:2378c1cc71b86cce');
    expect(mocks.updateDocuments).not.toHaveBeenCalled();
  });

  it('retains already-issued IPID bytes, filename and asset evidence on recovery', async () => {
    const existing: GeneratedDocument = { id: 'original-ipid', type: 'TRAVEL_IPID_PDF', filename: 'Original_Travel_IPID.pdf', fileHash: 'original-issued-hash', templateVersion: 'original:asset-version', status: 'GENERATED', version: 1, storageUri: 'https://files.example/original.pdf', docPack: 'ISSUED_POLICY_PACK', riskTransactionId: 'bound-risk' };
    prepareIssuedPolicy('annual_multi_trip', existing);
    const result = await executeTravelDocPackGeneration({ policyId: 'travel-issued', riskTransactionId: 'bound-risk', docPack: 'ISSUED_POLICY_PACK', source: 'SYSTEM' });
    expect(result.documents.find((doc) => doc.type === 'TRAVEL_IPID_PDF')).toEqual(existing);
    expect(mocks.createDocument.mock.calls.every(([args]) => args.data.type !== 'TRAVEL_IPID_PDF')).toBe(true);
    expect(mocks.updateDocuments).not.toHaveBeenCalled();
  });
});
