import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../products/testHelpers/tenantFixtures.js';

const { backOfficeMock } = vi.hoisted(() => ({ backOfficeMock: vi.fn() }));
vi.mock('../../../platform/db/connection.js', () => ({ tenantScopedPrisma: {} }));
vi.mock('../../../platform/http/middleware/auth.js', () => ({ isBackOfficeRequest: backOfficeMock }));
import { enforcePolicyProgrammeChannelGate } from '../../../modules/policy/http/productChannelGate.js';

const tenant = getTenantFixtures().find((entry) => entry.countryCode === 'GR')!;

describe('product channel authority before role bypass', () => {
  it.each(['questions', 'quote', 'payment'] as const)('denies Greece Motor %s for a back-office user before querying enabled switches', async (gate) => {
    backOfficeMock.mockReturnValue(true);
    const app = express();
    app.get('/gate', (req, res, next) => {
      void runWithOperatingTenant(tenant, async () => {
        if (await enforcePolicyProgrammeChannelGate(req, res, {
          productType: 'MOTOR',
          programId: 'not-reached',
          binderId: 'not-reached',
        }, gate)) res.sendStatus(204);
      }).catch(next);
    });
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP test server');
      const response = await fetch(`http://127.0.0.1:${address.port}/gate`);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ success: false, error: { code: 'PRODUCT_UNAVAILABLE', message: expect.stringContaining('MOTOR/GR') } });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
