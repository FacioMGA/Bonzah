import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../products/testHelpers/tenantFixtures.js';

const db = vi.hoisted(() => ({
  policy: { findUnique: vi.fn(), update: vi.fn() },
  program: { findUnique: vi.fn() },
  binder: { findUnique: vi.fn() },
  programBinderLink: { findFirst: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../../../platform/db/connection.js', () => ({ prisma: db, tenantScopedPrisma: db }));
vi.mock('../../../platform/audit/logger.js', () => ({ AuditLogger: { log: vi.fn() } }));
vi.mock('../../../modules/policy/app/policyListIndex.js', () => ({ enqueuePolicyListIndexUpdate: vi.fn() }));
vi.mock('../../../modules/policy/app/quoteLifecycle/rateQuoteUseCase.js', () => ({ rateQuoteUseCase: vi.fn() }));
vi.mock('../../../modules/policy/app/issueReadiness.js', () => ({ evaluateIssueReadiness: vi.fn() }));
vi.mock('../../../platform/events/domainEvents.js', () => ({ appendDomainEvent: vi.fn(), buildDomainEvent: vi.fn() }));
vi.mock('../../../platform/utils/platformIds.js', () => ({ reserveNextQuoteId: vi.fn() }));
vi.mock('../../../modules/policy/app/shared.js', () => ({ jsonStringify: JSON.stringify, newPublicSessionToken: vi.fn() }));

import { registerPolicyMutationRoutes } from '../../../modules/policy/http/mutationsRouter.js';

beforeEach(() => {
  vi.clearAllMocks();
  db.policy.findUnique.mockResolvedValue({ id: 'policy', status: 'DRAFT', isLocked: false });
  db.program.findUnique.mockResolvedValue({ id: 'program', status: 'ACTIVE', productType: 'MOTOR' });
  db.binder.findUnique.mockResolvedValue({ id: 'binder', status: 'ACTIVE', agreementNumber: 'same-agreement' });
  // This stale-link shape would enter the self-heal mutation if authority were checked too late.
  db.programBinderLink.findFirst.mockResolvedValueOnce(null).mockResolvedValue({ id: 'fallback-link' });
});

async function assignProgram(countryCode: string) {
  const tenant = getTenantFixtures().find((entry) => entry.countryCode === countryCode);
  if (!tenant) throw new Error(`Missing tenant fixture ${countryCode}`);
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => runWithOperatingTenant(tenant, next));
  const router = express.Router();
  registerPolicyMutationRoutes(router);
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test server');
    const response = await fetch(`http://127.0.0.1:${address.port}/policy/program-binder`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ programId: 'program', binderId: 'binder' }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

describe('program assignment availability before binder-link repair', () => {
  it('rejects Greece Motor without looking up or reactivating a fallback link', async () => {
    const response = await assignProgram('GR');
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'PRODUCT_UNAVAILABLE' } });
    expect(db.programBinderLink.findFirst).not.toHaveBeenCalled();
    expect(db.programBinderLink.upsert).not.toHaveBeenCalled();
    expect(db.policy.update).not.toHaveBeenCalled();
  });

  it('retains binder validation for offered Cyprus Motor', async () => {
    db.binder.findUnique.mockResolvedValue({ id: 'binder', status: 'EXPIRED', agreementNumber: 'same-agreement' });
    const response = await assignProgram('CY');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'BINDER_NOT_ACTIVE' } });
    expect(db.programBinderLink.upsert).not.toHaveBeenCalled();
  });
});
