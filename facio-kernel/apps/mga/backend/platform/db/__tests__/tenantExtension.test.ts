/**
 * Tests for the operatingTenantAutoInject Prisma extension.
 *
 * We test `applyTenantInjection` — the pure injection logic — directly rather
 * than going through Prisma's $extends API. This avoids the need for a live DB
 * and keeps tests fast.
 */

import { PrismaClient } from '@prisma/client';
import { describe, it, expect, vi } from 'vitest';
import {
  runWithOperatingTenant,
  withoutOperatingTenantForTest,
} from '../../tenant/tenantAls.js';
import {
  applyTenantInjection,
  runInsideTenantTransaction,
  TenantContextError,
  TenantMismatchError,
  TENANT_GUC_TX_OPTIONS,
  type PrismaArgsObject,
} from '../tenantExtension.js';
import { TENANT_IDS, type TenantConfig } from '../../tenant/tenantConfig.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CY_CONFIG: TenantConfig = {
  id: TENANT_IDS.CY,
  tenantSlug: 'abbeygate-cy',
  countryCode: 'CY',
  country: 'Cyprus',
  currency: 'EUR',
  ipt: { flatFee: 0 },
  adminFee: 18,
  legalPack: 'cy',
  publicBaseUrl: 'https://abbeygate-cy.facio.io',
  fromEmail: 'no-reply@abbeygate.cy',
  brandLogo: { white: '', blue: '' },
};

const PT_CONFIG: TenantConfig = {
  ...CY_CONFIG,
  id: TENANT_IDS.PT,
  tenantSlug: 'abbeygate-pt',
  countryCode: 'PT',
  country: 'Portugal',
  ipt: { rate: 0.09 },
  legalPack: 'pt',
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/**
 * Call applyTenantInjection and return the args captured by the mock query.
 *
 * The capture-and-return shape uses `PrismaArgsObject` (re-exported from
 * `tenantExtension.ts` with its single FAC tag) — same boundary type as the
 * extension itself, which is honest because the test inspects only the
 * fields the extension touches (`operatingTenantId` and pass-through
 * preservation of caller-supplied keys). This matches the rule:
 * `PrismaArgsObject` is allowed at opaque framework boundaries when
 * the layer reads only a tiny known key, does not reinterpret the whole
 * object, passes the original shape onward, and downstream typing resumes
 * at `query(args)`.
 */
async function inject(
  model: string | undefined,
  operation: string,
  args: PrismaArgsObject,
  opts: { failClosed?: boolean } = {},
): Promise<PrismaArgsObject> {
  let captured: PrismaArgsObject = {};
  await applyTenantInjection({
    model,
    operation,
    args,
    failClosed: opts.failClosed ?? true,
    query: (a) => { captured = a; return Promise.resolve(null); },
  });
  return captured;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyTenantInjection', () => {
  // ADR-0019: tests that need tenant identity wrap in runWithOperatingTenant.
  // Outside that wrap, getTenantConfig() throws — which the fail-closed
  // cases below assert via TenantContextError.

  // --- Non-scoped models ---

  it('passes args through unchanged for a non-scoped model (User)', async () => {
    const originalArgs = { where: { id: '123' } };
    const result = await inject('User', 'findMany', originalArgs);
    expect(result).toStrictEqual(originalArgs);
  });

  it('passes args through for undefined model', async () => {
    const originalArgs = { where: {} };
    const result = await inject(undefined, 'findMany', originalArgs);
    expect(result).toStrictEqual(originalArgs);
  });

  // --- Fail-closed ---

  it('throws TenantContextError for a scoped model when no ALS context (failClosed=true)', async () => {
    await withoutOperatingTenantForTest(async () => {
      await expect(inject('AuditAction', 'findMany', {})).rejects.toThrow(TenantContextError);
    });
  });

  it('does not throw inside a runWithOperatingTenant context', async () => {
    let result: PrismaArgsObject | undefined;
    await runWithOperatingTenant(CY_CONFIG, async () => {
      result = await inject('AuditAction', 'findMany', {});
    });
    expect(result).toBeDefined();
  });

  // --- Fail-open ---

  it('passes args through without injection when no ALS context and failClosed=false', async () => {
    await withoutOperatingTenantForTest(async () => {
      const result = await inject('AuditAction', 'findMany', { where: {} }, { failClosed: false });
      expect(result).not.toHaveProperty('where.operatingTenantId');
    });
  });

  // --- Read injection ---

  it('injects operatingTenantId into where clause for findMany', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(CY_CONFIG, async () => {
      result = await inject('Outbox', 'findMany', { where: { processed: false } });
    });
    expect(result.where).toMatchObject({ processed: false, operatingTenantId: CY_CONFIG.id });
  });

  it('injects operatingTenantId into where clause for count', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(PT_CONFIG, async () => {
      result = await inject('RecoEvent', 'count', {});
    });
    expect((result.where as PrismaArgsObject).operatingTenantId).toBe(PT_CONFIG.id);
  });

  it('injects the correct tenant ID for PT config on findMany', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(PT_CONFIG, async () => {
      result = await inject('WebhookEndpoint', 'findMany', {});
    });
    expect((result.where as PrismaArgsObject).operatingTenantId).toBe(PT_CONFIG.id);
  });

  it('injects into where for update', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(CY_CONFIG, async () => {
      result = await inject('SanctionScreeningRun', 'update', { where: { id: 'x' }, data: {} });
    });
    expect((result.where as PrismaArgsObject).operatingTenantId).toBe(CY_CONFIG.id);
  });

  it('injects into where for deleteMany', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(CY_CONFIG, async () => {
      result = await inject('PolicyListIndex', 'deleteMany', { where: { status: 'ARCHIVED' } });
    });
    expect((result.where as PrismaArgsObject).operatingTenantId).toBe(CY_CONFIG.id);
  });

  // --- Write injection ---

  it('injects operatingTenantId into data for create', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(CY_CONFIG, async () => {
      result = await inject('AuditAction', 'create', {
        data: { entityId: 'e1', entityType: 'Policy', actionName: 'BIND', actorType: 'USER', actorId: 'u1' },
      });
    });
    expect((result.data as PrismaArgsObject).operatingTenantId).toBe(CY_CONFIG.id);
  });

  it('injects operatingTenantId into all rows for createMany', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(PT_CONFIG, async () => {
      result = await inject('Outbox', 'createMany', {
        data: [{ aggregateId: 'a1', eventType: 'X', payload: {} }],
      });
    });
    const rows = result.data as Array<PrismaArgsObject>;
    expect(rows[0].operatingTenantId).toBe(PT_CONFIG.id);
  });

  it('injects operatingTenantId into upsert.create but never into upsert.update (immutable column)', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(CY_CONFIG, async () => {
      result = await inject('RecoBanditArm', 'upsert', {
        where: { id: 'x' },
        create: { bundleId: 'b1', productType: 'MOTOR' },
        update: { successes: 1 },
      });
    });
    // create branch: ALS value injected as the canonical write.
    expect((result.create as PrismaArgsObject).operatingTenantId).toBe(CY_CONFIG.id);
    // update branch: tenantId is immutable on the row, so the extension never
    // attempts to write it through an update — the strip-after-assert rule.
    // (Dedicated tests below cover the throw-on-mismatch path and the
    // strip-when-equal-and-supplied path.)
    expect(result.update as PrismaArgsObject).not.toHaveProperty('operatingTenantId');
  });

  // --- Caller-supplied operatingTenantId: must match ALS or throw ---

  // The extension previously OVERRODE a caller-supplied operatingTenantId
  // with the ALS value silently — a tenant-isolation footgun: a worker that
  // read `operatingTenantId: A` from a parent row and passed it through could
  // end up writing the row under tenant `B` if ALS context was `B`, with no
  // log, no exception, no audit trail. New contract: the extension throws
  // TenantMismatchError on disagreement and preserves the caller's value
  // (which by then is verified equal to ALS) on agreement.

  it('preserves the caller-supplied operatingTenantId on where when it matches ALS', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(CY_CONFIG, async () => {
      result = await inject('ApiKey', 'findMany', {
        where: { operatingTenantId: CY_CONFIG.id, name: 'foo' },
      });
    });
    expect((result.where as PrismaArgsObject).operatingTenantId).toBe(CY_CONFIG.id);
    expect((result.where as PrismaArgsObject).name).toBe('foo');
  });

  it('throws TenantMismatchError when where.operatingTenantId disagrees with ALS', async () => {
    await runWithOperatingTenant(CY_CONFIG, async () => {
      await expect(
        inject('ApiKey', 'findMany', { where: { operatingTenantId: PT_CONFIG.id } }),
      ).rejects.toThrow(TenantMismatchError);
    });
  });

  it('throws TenantMismatchError when create.data.operatingTenantId disagrees with ALS', async () => {
    await runWithOperatingTenant(CY_CONFIG, async () => {
      await expect(
        inject('AuditAction', 'create', {
          data: { operatingTenantId: PT_CONFIG.id, entityId: 'e1', entityType: 'Policy', actionName: 'BIND', actorType: 'USER', actorId: 'u1' },
        }),
      ).rejects.toThrow(TenantMismatchError);
    });
  });

  it('preserves a matching caller-supplied operatingTenantId on create.data', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(CY_CONFIG, async () => {
      result = await inject('AuditAction', 'create', {
        data: { operatingTenantId: CY_CONFIG.id, entityId: 'e1', entityType: 'Policy', actionName: 'BIND', actorType: 'USER', actorId: 'u1' },
      });
    });
    expect((result.data as PrismaArgsObject).operatingTenantId).toBe(CY_CONFIG.id);
  });

  it('throws TenantMismatchError when any createMany row disagrees with ALS (with row index in message)', async () => {
    await runWithOperatingTenant(PT_CONFIG, async () => {
      const promise = inject('Outbox', 'createMany', {
        data: [
          { aggregateId: 'a1', eventType: 'X', payload: {} },
          { aggregateId: 'a2', eventType: 'Y', payload: {}, operatingTenantId: CY_CONFIG.id },
        ],
      });
      await expect(promise).rejects.toThrow(TenantMismatchError);
      await expect(promise).rejects.toThrow(/data\[1\]/);
    });
  });

  it('throws TenantMismatchError when upsert.create disagrees with ALS', async () => {
    await runWithOperatingTenant(CY_CONFIG, async () => {
      await expect(
        inject('RecoBanditArm', 'upsert', {
          where: { id: 'x' },
          create: { operatingTenantId: PT_CONFIG.id, bundleId: 'b1', productType: 'MOTOR' },
          update: { successes: 1 },
        }),
      ).rejects.toThrow(TenantMismatchError);
    });
  });

  it('throws TenantMismatchError when upsert.update disagrees with ALS', async () => {
    await runWithOperatingTenant(CY_CONFIG, async () => {
      await expect(
        inject('RecoBanditArm', 'upsert', {
          where: { id: 'x' },
          create: { bundleId: 'b1', productType: 'MOTOR' },
          update: { operatingTenantId: PT_CONFIG.id, successes: 1 },
        }),
      ).rejects.toThrow(TenantMismatchError);
    });
  });

  it('strips operatingTenantId from upsert.update after asserting equality (immutable column)', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(CY_CONFIG, async () => {
      result = await inject('RecoBanditArm', 'upsert', {
        where: { id: 'x' },
        create: { bundleId: 'b1', productType: 'MOTOR' },
        // Caller passes the matching tenant id on the update branch.
        // The extension must accept it (no throw) and then remove it from the
        // payload Prisma actually sees: tenantId is immutable on the row, so
        // the underlying UPDATE must not attempt to set it.
        update: { operatingTenantId: CY_CONFIG.id, successes: 1 },
      });
    });
    const update = result.update as PrismaArgsObject;
    expect(update.successes).toBe(1);
    expect(update).not.toHaveProperty('operatingTenantId');
    // Create branch keeps the canonical ALS value.
    expect((result.create as PrismaArgsObject).operatingTenantId).toBe(CY_CONFIG.id);
  });

  it('strips operatingTenantId from upsert.update even when caller did not supply it', async () => {
    let result: PrismaArgsObject = {};
    await runWithOperatingTenant(CY_CONFIG, async () => {
      result = await inject('RecoBanditArm', 'upsert', {
        where: { id: 'x' },
        create: { bundleId: 'b1', productType: 'MOTOR' },
        update: { successes: 1 },
      });
    });
    const update = result.update as PrismaArgsObject;
    expect(update.successes).toBe(1);
    expect(update).not.toHaveProperty('operatingTenantId');
  });

  it('TenantMismatchError is also a TenantContextError (instanceof preserved for HTTP error mappers)', async () => {
    await runWithOperatingTenant(CY_CONFIG, async () => {
      await expect(
        inject('ApiKey', 'findMany', { where: { operatingTenantId: PT_CONFIG.id } }),
      ).rejects.toThrow(TenantContextError);
    });
  });
});

describe('TENANT_GUC_TX_OPTIONS', () => {
  // Regression lock for Cluster A (Sentry ABBEYGATE-X / -11 / -12 / -13 / -Z):
  // the per-query GUC wrap and the accounts-360 projection rebuild were tripping
  // `Transaction API error: Transaction already closed … 5069–6970 ms passed`
  // against Prisma's 5000 ms interactive-transaction default. The wrap must run
  // with a ceiling comfortably above 5 s so tenant-scoped work that legitimately
  // contends under load (PDF render + blob upload, projection batches) does not
  // expire at exactly 5 s. If this drops back to <= 5000, those errors return.
  it('keeps the interactive-transaction timeout above the fatal 5s default', () => {
    expect(TENANT_GUC_TX_OPTIONS.timeout).toBeGreaterThan(5000);
    expect(Number.isFinite(TENANT_GUC_TX_OPTIONS.timeout)).toBe(true);
  });

  it('keeps a positive, finite maxWait for connection acquisition', () => {
    expect(TENANT_GUC_TX_OPTIONS.maxWait).toBeGreaterThan(0);
    expect(Number.isFinite(TENANT_GUC_TX_OPTIONS.maxWait)).toBe(true);
  });
});

describe('runInsideTenantTransaction', () => {
  it('reuses the outer transaction instead of opening a per-query transaction', async () => {
    const baseClient = new PrismaClient();
    const transactionSpy = vi.spyOn(baseClient, '$transaction');
    const query = vi.fn(async (args: PrismaArgsObject) => args);

    try {
      await runWithOperatingTenant(CY_CONFIG, () =>
        runInsideTenantTransaction(() =>
          applyTenantInjection({
            model: 'Policy',
            operation: 'findUnique',
            args: { where: { id: 'policy-1' } },
            query,
            failClosed: true,
            baseClient,
          }),
        ),
      );

      expect(transactionSpy).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledWith({
        where: { id: 'policy-1', operatingTenantId: CY_CONFIG.id },
      });
    } finally {
      transactionSpy.mockRestore();
      await baseClient.$disconnect();
    }
  });
});
