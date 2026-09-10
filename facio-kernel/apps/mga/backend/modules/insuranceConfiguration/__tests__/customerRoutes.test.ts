import express from 'express';
import jwt from 'jsonwebtoken';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticCommercialConfiguration, commercialContext } from '../../../products/commercial/__tests__/fixtures.js';
import { ProgramDefinitionConfigurationError } from '../../programs/domain/programDefinition.js';

const mocks = vi.hoisted(() => ({
  policy: vi.fn(), claim: vi.fn(), document: vi.fn(), authority: vi.fn(), definition: vi.fn(),
  ownership: vi.fn(), claimOwnership: vi.fn(), execute: vi.fn(), publicExecute: vi.fn(), stream: vi.fn(),
  transition: vi.fn(), outbox: vi.fn(), stateUpsert: vi.fn(), indexUpdate: vi.fn(),
}));
vi.mock('../../../platform/db/connection.js', () => ({ tenantScopedPrisma: {
  policy: { findUnique: mocks.policy }, claim: { findUnique: mocks.claim },
  document: { findFirst: mocks.document }, binderProductAuthority: { findFirst: mocks.authority },
}, runTenantScopedTransaction: async (callback: (tx: unknown) => unknown) => callback({ policySearchIndex: { update: mocks.indexUpdate }, policyStateCurrent: { upsert: mocks.stateUpsert }, outbox: { create: mocks.outbox } }) }));
vi.mock('../../../platform/tenant/tenantConfig.js', () => ({ getTenantConfig: () => ({ id: 'tenant-a' }) }));
vi.mock('../../programs/app/activeProgramDefinition.js', () => ({ resolveMappedProgramDefinition: mocks.definition }));
vi.mock('../../policy/app/customerPolicyAccess.js', () => ({ resolveCustomerPolicyAccess: mocks.ownership, customerCanAccessPolicy: mocks.claimOwnership, listCustomerOwnedPolicyIds: vi.fn() }));
vi.mock('../../claims/app/httpConductorDeps.js', () => ({ claimsHttpDeps: { executeClaimWorksheetCommand: mocks.publicExecute, normalizeCanonicalIntake: (value: unknown) => value } }));
vi.mock('../../claims/app/commands/executeWorksheetCommand.js', () => ({ executeWorksheetCommand: mocks.execute }));
vi.mock('../../claims/app/queries/getClaimWorksheetView.js', () => ({ getClaimWorksheetView: vi.fn() }));
vi.mock('../../claims/app/queries/listClaimsPage.js', () => ({ listClaimsPage: vi.fn() }));
vi.mock('../../../platform/storage/service.js', () => ({ storageService: { getFileStream: mocks.stream, uploadFile: vi.fn() } }));
vi.mock('../../accessControl/http/permissionMiddleware.js', () => ({ requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(), requireDocumentFetchPermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next() }));

vi.mock('../../claims/app/resolveProgrammeClaimsContract.js', () => ({ resolveProgrammeClaimsContract: vi.fn(async () => ({ synthetic: true })) }));
vi.mock('../../../platform/audit/logger.js', () => ({ AuditLogger: { log: vi.fn() } }));
vi.mock('../../policy/app/mbeInterop.js', () => ({ MagicBRegistry: {} }));
vi.mock('../../policy/app/commands/policyLifecycleCommands.js', () => ({ transitionPolicyLifecycle: mocks.transition }));
vi.mock('../../policy/app/policyListIndex.js', () => ({ enqueuePolicyListIndexUpdate: vi.fn() }));

import { requirePolicyAccess } from '../../../http/middleware/policyAccess.js';
import { registerPolicyCancellationRoutes } from '../../policy/http/cancellationsRouter.js';
import publicFnolRouter from '../../claims/http/publicFnolRouter.js';
import clientClaimsRouter from '../../claims/http/clientClaimsRouter.js';
import documentsRouter from '../../documents/http/documentsRouter.js';

let configuration = syntheticCommercialConfiguration();
beforeEach(() => {
  vi.resetAllMocks();
  configuration = syntheticCommercialConfiguration();
  Object.assign(configuration.process.customers, { docs: true, portal: true, claim: true, cancel: true });
  mocks.policy.mockResolvedValue({ id: 'policy-a', programId: 'program-a', binderId: 'binder-a', productType: 'COMMERCIAL', status: 'ACTIVE', inceptionDate: new Date('2026-01-01'), expiryDate: new Date('2099-12-31'), stateCurrent: { snapshot: {} }, policyHolder: { contact: 'synthetic@example.invalid' } });
  mocks.claim.mockResolvedValue({ id: 'claim-a', policyId: 'policy-a', policy: { programId: 'program-a', binderId: 'binder-a', productType: 'COMMERCIAL' } });
  mocks.document.mockResolvedValue({ policyId: 'policy-a', docPack: 'ISSUED_POLICY_PACK', type: 'HOME_SCHEDULE_PDF' });
  mocks.authority.mockResolvedValue({ id: 'authority-a' });
  mocks.definition.mockImplementation(async () => commercialContext(configuration).programDefinition);
  mocks.ownership.mockResolvedValue('ok');
  mocks.claimOwnership.mockResolvedValue(true);
  mocks.execute.mockResolvedValue(undefined); mocks.publicExecute.mockResolvedValue(undefined);
  mocks.indexUpdate.mockResolvedValue({}); mocks.stateUpsert.mockResolvedValue({}); mocks.outbox.mockResolvedValue({});
  vi.stubEnv('JWT_SECRET', 'isolated-test-fnol-signing-secret');
  mocks.stream.mockImplementation(async () => Readable.from(['synthetic-pdf-bytes']));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function request(path: string, method = 'GET', role = 'CUSTOMER') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'user-a', name: 'Synthetic operator', role }; next(); });
  app.use('/claims', clientClaimsRouter);
  app.use('/public-fnol', publicFnolRouter);
  const policies = express.Router(); policies.use('/:id', requirePolicyAccess); registerPolicyCancellationRoutes(policies);
  app.use('/policies', policies);
  app.use('/documents', documentsRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Local HTTP listener missing');
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ form: { incident: { type: 'synthetic' } }, portal: true, claim: true, requestedEffectiveDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }) } : {}),
    });
    return { status: response.status, text: await response.text() };
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

function assertSelectedAuthority() {
  expect(mocks.authority).toHaveBeenCalledWith({ where: { operatingTenantId: 'tenant-a', binderId: 'binder-a', productCode: 'COMMERCIAL' }, select: { id: true } });
  expect(mocks.definition).toHaveBeenCalledWith({ programId: 'program-a', binderProductAuthorityId: 'authority-a' });
  expect(mocks.definition).toHaveBeenCalledOnce();
}

describe('published customer capabilities at actual HTTP execution boundaries', () => {
  it('submits an owned FNOL only when claim and portal are published on', async () => {
    expect((await request('/claims/claim-a/fnol/submit', 'POST')).status).toBe(200);
    expect(mocks.claimOwnership).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-a' }), 'policy-a');
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ claimId: 'claim-a', type: 'SUBMIT_FNOL', actor: expect.objectContaining({ actorType: 'CUSTOMER', actorId: 'user-a' }) }));
    assertSelectedAuthority();
  });
  it.each(['claim', 'portal'] as const)('refuses FNOL when published %s is off even if body claims it is on', async capability => {
    configuration.process.customers[capability] = false;
    const result = await request('/claims/claim-a/fnol/submit', 'POST');
    expect(result.status).toBe(403); expect(result.text).toContain('INSURANCE_CONFIGURATION_INVALID');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('does not reveal a claim or evaluate permissions before ownership succeeds', async () => {
    mocks.claimOwnership.mockResolvedValue(false);
    expect((await request('/claims/claim-a/fnol/submit', 'POST')).status).toBe(404);
    expect(mocks.definition).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('streams a customer-owned document only with documents and portal enabled on one definition', async () => {
    const result = await request('/documents/schedule.pdf');
    expect(result).toEqual({ status: 200, text: 'synthetic-pdf-bytes' });
    expect(mocks.ownership).toHaveBeenCalledWith(expect.objectContaining({ role: 'CUSTOMER' }), 'policy-a');
    expect(mocks.stream).toHaveBeenCalledOnce(); assertSelectedAuthority();
  });
  it.each(['docs', 'portal'] as const)('refuses customer document bytes when published %s is off', async capability => {
    configuration.process.customers[capability] = false;
    const result = await request('/documents/schedule.pdf');
    expect(result.status).toBe(403); expect(result.text).toContain('INSURANCE_CONFIGURATION_INVALID');
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it('does not resolve another policy definition or read bytes when ownership is denied', async () => {
    mocks.ownership.mockResolvedValue('denied');
    expect((await request('/documents/schedule.pdf')).status).toBe(403);
    expect(mocks.definition).not.toHaveBeenCalled(); expect(mocks.stream).not.toHaveBeenCalled();
  });
  it.each([['/claims/claim-a/fnol/submit', 'POST'], ['/documents/schedule.pdf', 'GET']])('refuses %s when the configured product is inactive', async (path, method) => {
    configuration.product.active = false;
    expect((await request(path, method)).status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.stream).not.toHaveBeenCalled();
  });
  it.each([['/claims/claim-a/fnol/submit', 'POST'], ['/documents/schedule.pdf', 'GET']])('fails closed for %s when no published mapping is available', async (path, method) => {
    mocks.definition.mockRejectedValue(new ProgramDefinitionConfigurationError('authority-a', 'mapping missing'));
    const result = await request(path, method);
    expect(result.status).toBe(503); expect(result.text).toContain('BINDER_PROGRAM_DEFINITION_NOT_PUBLISHED');
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.stream).not.toHaveBeenCalled();
  });
  it('preserves separately authorized back-office document review when customer portal and documents are off', async () => {
    configuration.process.customers.docs = false; configuration.process.customers.portal = false;
    expect((await request('/documents/schedule.pdf', 'GET', 'UNDERWRITER')).status).toBe(200);
    expect(mocks.ownership).not.toHaveBeenCalled(); expect(mocks.definition).not.toHaveBeenCalled();
    expect(mocks.stream).toHaveBeenCalledOnce();
  });
});


function fnolPath(action: 'context' | 'submit', claims = {}) {
  const token = jwt.sign({ purpose: 'PUBLIC_FNOL', claimId: 'claim-a', policyId: 'policy-a', ...claims }, process.env.JWT_SECRET!, { expiresIn: 300 });
  return `/public-fnol/${token}/${action}`;
}

describe('alternate customer entry points preserve published capability gates', () => {
  it.each(['context', 'submit'] as const)('allows a valid signed FNOL %s only for the selected enabled policy', async action => {
    const result = await request(fnolPath(action), action === 'submit' ? 'POST' : 'GET');
    expect(result.status).toBe(200); assertSelectedAuthority();
    if (action === 'submit') expect(mocks.publicExecute).toHaveBeenCalledWith(expect.objectContaining({ claimId: 'claim-a', type: 'SUBMIT_FNOL' }));
  });
  it.each([
    ['context', 'claim'], ['context', 'portal'], ['submit', 'claim'], ['submit', 'portal'],
  ] as const)('denies signed FNOL %s when published %s is off', async (action, flag) => {
    configuration.process.customers[flag] = false;
    expect((await request(fnolPath(action), action === 'submit' ? 'POST' : 'GET')).status).toBe(403);
    expect(mocks.publicExecute).not.toHaveBeenCalled();
  });
  it.each(['context', 'submit'] as const)('rejects signed FNOL %s with the wrong policy before resolving capabilities', async action => {
    expect((await request(fnolPath(action, { policyId: 'other-policy' }), action === 'submit' ? 'POST' : 'GET')).status).toBe(404);
    expect(mocks.definition).not.toHaveBeenCalled(); expect(mocks.publicExecute).not.toHaveBeenCalled();
  });
  it.each(['context', 'submit'] as const)('rejects an invalid signature on %s before reading records or executing commands', async action => {
    const token = jwt.sign({ purpose: 'PUBLIC_FNOL', claimId: 'claim-a', policyId: 'policy-a' }, 'wrong-key');
    expect((await request(`/public-fnol/${token}/${action}`, action === 'submit' ? 'POST' : 'GET')).status).toBe(action === 'submit' ? 400 : 401);
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.publicExecute).not.toHaveBeenCalled();
  });
  it.each(['context', 'submit'] as const)('denies signed FNOL %s when product inactive or its mapping unavailable', async action => {
    configuration.product.active = false;
    expect((await request(fnolPath(action), action === 'submit' ? 'POST' : 'GET')).status).toBe(403);
    configuration.product.active = true;
    mocks.definition.mockRejectedValue(new ProgramDefinitionConfigurationError('authority-a', 'mapping missing'));
    expect((await request(fnolPath(action), action === 'submit' ? 'POST' : 'GET')).status).toBe(503);
    expect(mocks.publicExecute).not.toHaveBeenCalled();
  });
  it('allows a customer cancellation request after ownership and published cancel/portal checks', async () => {
    const result = await request('/policies/policy-a/cancellation/request', 'POST');
    expect(result.status, result.text).toBe(200); assertSelectedAuthority();
    expect(mocks.ownership).toHaveBeenCalledWith(expect.objectContaining({ role: 'CUSTOMER' }), 'policy-a');
    expect(mocks.transition).toHaveBeenCalledWith(expect.objectContaining({ policyId: 'policy-a', to: 'CANCELLATION_REQUESTED' }));
    expect(mocks.outbox).toHaveBeenCalledOnce();
  });
  it.each(['cancel', 'portal'] as const)('denies customer cancellation when %s is off before lifecycle or outbox writes', async flag => {
    configuration.process.customers[flag] = false;
    expect((await request('/policies/policy-a/cancellation/request', 'POST')).status).toBe(403);
    expect(mocks.transition).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled();
  });
  it('denies another customer policy before evaluating cancellation capabilities', async () => {
    mocks.ownership.mockResolvedValue('denied');
    expect((await request('/policies/policy-a/cancellation/request', 'POST')).status).toBe(403);
    expect(mocks.definition).not.toHaveBeenCalled(); expect(mocks.transition).not.toHaveBeenCalled();
  });
  it('denies customer cancellation for inactive products and unavailable mappings', async () => {
    configuration.product.active = false;
    expect((await request('/policies/policy-a/cancellation/request', 'POST')).status).toBe(403);
    configuration.product.active = true;
    mocks.definition.mockRejectedValue(new ProgramDefinitionConfigurationError('authority-a', 'mapping missing'));
    expect((await request('/policies/policy-a/cancellation/request', 'POST')).status).toBe(503);
    expect(mocks.transition).not.toHaveBeenCalled(); expect(mocks.outbox).not.toHaveBeenCalled();
  });
  it('retains staff cancellation-request access independently of customer portal flags', async () => {
    configuration.process.customers.cancel = false; configuration.process.customers.portal = false;
    expect((await request('/policies/policy-a/cancellation/request', 'POST', 'UNDERWRITER')).status).toBe(200);
    expect(mocks.definition).not.toHaveBeenCalled(); expect(mocks.transition).toHaveBeenCalledOnce();
  });
});
