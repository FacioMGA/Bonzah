import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ tenant: 'tenant-a', policy: vi.fn(), risk: vi.fn(), outboxFind: vi.fn(), outboxCreate: vi.fn(), lock: vi.fn(), transaction: vi.fn() }));
vi.mock('../../../../platform/db/connection.js', () => {
  const tx = { policy: { findFirst: mocks.policy }, riskTransaction: { findFirst: mocks.risk }, outbox: { findFirst: mocks.outboxFind, create: mocks.outboxCreate }, $queryRaw: mocks.lock };
  return { tenantScopedPrisma: tx, prisma: tx, runTenantScopedTransaction: (fn: (tx: unknown) => Promise<unknown>) => { mocks.transaction(); return fn(tx); } };
});
vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({ getTenantConfig: () => ({ id: mocks.tenant, countryCode: 'CY' }) }));
import { registerAllProducts } from '../../../../products/registerProducts.js';
import { fixtureProgrammeDefinition } from '../../../../products/programDefinitionFixtures.js';
import { retryIssuedPolicyDocuments } from '../retryIssuedPolicyDocuments.js';

const policyId = '2d2eb643-7466-4698-9aa1-800b390d1e97';
const actor = { id: 'operator', role: 'ADMIN', permissions: ['documents.generate', 'policies.view'] };
const now = new Date('2026-09-07T12:00:01Z');
const bound = () => ({ id: 'risk-a', policyId, programId: fixtureProgrammeDefinition('MOTOR').programId, snapshotFinal: { quoteData: { reference: 'frozen-risk' }, quoteResponse: { premium: 293.39 }, programDefinition: fixtureProgrammeDefinition('MOTOR') } });

describe('operator issued document recovery', () => {
  beforeAll(() => registerAllProducts());
  beforeEach(() => {
    vi.clearAllMocks(); mocks.tenant = 'tenant-a';
    mocks.policy.mockResolvedValue({ id: policyId, status: 'ISSUED', productType: 'MOTOR', programId: bound().programId });
    mocks.risk.mockResolvedValue(bound()); mocks.outboxFind.mockResolvedValue(null); mocks.outboxCreate.mockResolvedValue({});
  });
  it('retains the scoped original risk and queues only the canonical document-only envelope', async () => {
    const result = await retryIssuedPolicyDocuments({ policyId }, actor, now);
    expect(result).toMatchObject({ status: 'queued', riskTransactionId: 'risk-a', replayed: false });
    expect(mocks.policy).toHaveBeenCalledWith(expect.objectContaining({ where: { id: policyId, operatingTenantId: 'tenant-a' } }));
    expect(mocks.risk).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ policyId, operatingTenantId: 'tenant-a', transactionType: 'INCEPTION' }) }));
    expect(mocks.outboxCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ operatingTenantId: 'tenant-a', eventId: result.eventId, payload: expect.objectContaining({ data: { policyId, riskTransactionId: 'risk-a', source: 'BO', generatedByUserId: 'operator', documentsOnly: true } }) }) }));
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.policy.mock.invocationCallOrder[0]);
  });
  it('deduplicates across actors within the server bucket and permits a later recovery event', async () => {
    const first = await retryIssuedPolicyDocuments({ policyId }, actor, now);
    mocks.outboxFind.mockResolvedValueOnce({ eventId: first.eventId });
    const replay = await retryIssuedPolicyDocuments({ policyId }, { ...actor, id: 'other-operator' }, new Date('2026-09-07T12:00:59Z'));
    expect(replay).toEqual({ ...first, replayed: true }); expect(mocks.outboxCreate).toHaveBeenCalledTimes(1);
    const later = await retryIssuedPolicyDocuments({ policyId }, actor, new Date('2026-09-07T12:01:00Z'));
    expect(later.eventId).not.toBe(first.eventId);
  });
  it('cannot recover a policy through another operating tenant', async () => {
    mocks.tenant = 'tenant-b'; mocks.policy.mockResolvedValue(null);
    await expect(retryIssuedPolicyDocuments({ policyId }, actor, now)).rejects.toMatchObject({ status: 404 });
    expect(mocks.policy).toHaveBeenCalledWith(expect.objectContaining({ where: { id: policyId, operatingTenantId: 'tenant-b' } }));
    expect(mocks.risk).not.toHaveBeenCalled(); expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });
  it.each(['QUOTED', 'DRAFT', 'CANCELLED'])('refuses status %s before accessing retained evidence', async (status) => {
    mocks.policy.mockResolvedValue({ id: policyId, status });
    await expect(retryIssuedPolicyDocuments({ policyId }, actor, now)).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    expect(mocks.risk).not.toHaveBeenCalled(); expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });
  it('does not substitute current quote state for a missing bound transaction', async () => {
    mocks.risk.mockResolvedValue(null);
    await expect(retryIssuedPolicyDocuments({ policyId }, actor, now)).rejects.toMatchObject({ code: 'MISSING_BOUND_SNAPSHOT' });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });
  it.each(['missing-definition', 'wrong-programme', 'missing-sources', 'empty-risk', 'wrong-policy'])('rejects retained evidence corruption: %s', async (failure) => {
    const risk = bound();
    if (failure === 'missing-definition') delete (risk.snapshotFinal as { programDefinition?: unknown }).programDefinition;
    if (failure === 'wrong-programme') risk.snapshotFinal.programDefinition.programId = 'another-programme';
    if (failure === 'missing-sources') delete risk.snapshotFinal.programDefinition.documents.sources;
    if (failure === 'empty-risk') risk.snapshotFinal.quoteData = {} as typeof risk.snapshotFinal.quoteData;
    if (failure === 'wrong-policy') risk.policyId = 'another-policy';
    mocks.risk.mockResolvedValue(risk);
    await expect(retryIssuedPolicyDocuments({ policyId }, actor, now)).rejects.toMatchObject({ code: 'INVALID_BOUND_SNAPSHOT' });
    expect(mocks.outboxCreate).not.toHaveBeenCalled();
  });
  it.each([{ ...actor, permissions: ['policies.view'] }, { ...actor, permissions: ['documents.generate'] }, { ...actor, role: 'CUSTOMER' }, { ...actor, id: '' }])('enforces trusted operator permissions before opening a transaction', async (unauthorized) => {
    await expect(retryIssuedPolicyDocuments({ policyId }, unauthorized, now)).rejects.toMatchObject({ status: 403 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
