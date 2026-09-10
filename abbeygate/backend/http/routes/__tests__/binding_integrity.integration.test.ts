import express from 'express';
import type { Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { createGenericPublicQuoteRouter } from '../../../modules/quotes/http/genericPublicQuoteRouter.js';
import { registerPolicyBindingRoutes } from '../../../modules/policy/http/bindingRouter.js';
import { motorGoldenFixtures } from '../../../products/motor/goldenFixtures.js';

const RUN_INTEGRATION = String(process.env.INTEGRATION_TESTS || '').toLowerCase() === 'true';

// CY tenant fixture — UUID matches the seeded tenant in
// `backend/seed/helpers.ts:TENANT_IDS.CY`. The Prisma schema now
// requires `operatingTenantId` on Program, Binder, PolicyHolder,
// Policy, PolicyStateCurrent, and PolicySearchIndex (ADR-0019 fail-
// closed tenancy); the `bindPolicyHandler` reads tenant context from
// the ALS scope established by `runWithOperatingTenant(...)`. Both
// invariants are pinned here so the test no longer hits
// `PrismaClientValidationError: Argument operatingTenant is missing`
// or `TenantNotResolvedError` when invoked under
// `INTEGRATION_TESTS=true`.
const CY_TENANT: TenantConfig = {
  id: '00000000-0000-4000-8000-000000000001',
  tenantSlug: 'abbeygate-cy',
  countryCode: 'CY',
  country: 'Cyprus',
  currency: 'EUR',
  ipt: { flatFee: 0 },
  adminFee: 18,
  legalPack: 'cy',
  publicBaseUrl: 'https://abbeygate-cy.facio.io',
  fromEmail: 'no-reply@facio.io',
  brandLogo: { white: '', blue: '' },
};

describe.runIf(RUN_INTEGRATION)('Binding integrity (integration)', () => {
  type PrismaClient = typeof import('../../../platform/db/connection.js').prisma;

  let prisma: PrismaClient;
  let server: Server;
  let baseUrl: string;

  let programId: string;
  let binderId: string;
  let previousQuoteTokenSecret: string | undefined;

  const createdPolicyIds: string[] = [];
  const createdPolicyHolderIds: string[] = [];
  const createdOutboxAggregateIds: string[] = [];

  const rnd = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    previousQuoteTokenSecret = process.env.QUOTE_TOKEN_SECRET;
    process.env.QUOTE_TOKEN_SECRET = previousQuoteTokenSecret || 'binding-integrity-integration-quote-token-secret';

    // Dynamic imports so non-integration runs don't require DATABASE_URL.
    ({ prisma } = await import('../../../platform/db/connection.js'));

    // Binding validates issue-readiness via the per-product
    // adapter (`IProductAdapter`). Without an explicit registration the
    // adapter registry is empty and the handler short-circuits with
    // `PRODUCT_NOT_SUPPORTED: 'MOTOR' does not have a registered
    // readiness adapter`. The product registry is process-scoped and
    // idempotent so calling it here is safe across test runs.
    const { registerAllProducts } = await import('../../../products/registerProducts.js');
    registerAllProducts();

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 'integration-user', name: 'Integration User', role: 'ADMIN' };
      req.correlationId = `corr-${Date.now()}`;
      runWithOperatingTenant(CY_TENANT, next);
    });
    app.use('/api/public/motor/session', createGenericPublicQuoteRouter('motor'));
    const policyBindingRouter = express.Router();
    registerPolicyBindingRoutes(policyBindingRouter);
    app.use('/api/policies', policyBindingRouter);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Integration test HTTP server did not bind to a port');
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Minimal shared fixtures — every tenant-scoped model now requires
    // `operatingTenantId` (ADR-0019). Use the seeded CY tenant.
    await prisma.productDefinition.upsert({
      where: { code: 'MOTOR' },
      update: { displayName: 'Motor', isActive: true },
      create: { code: 'MOTOR', displayName: 'Motor', isActive: true },
    });

    const effectiveFrom = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const effectiveTo = new Date(Date.now() + 370 * 24 * 60 * 60 * 1000);
    const program = await prisma.program.create({
      data: {
        name: rnd('Integration Program'),
        status: 'ACTIVE',
        productType: 'MOTOR',
        effectiveFrom,
        effectiveTo,
        metadata: { programCode: 'abbeygate_motor_integration' },
        operatingTenantId: CY_TENANT.id,
      },
      select: { id: true },
    });
    programId = program.id;

    const binder = await prisma.binder.create({
      data: {
        coverholderName: 'Integration Coverholder',
        umr: rnd('B6081 INTEGRATION'),
        agreementNumber: rnd('INTEGRATION'),
        lloydsReportingVer: 'V5.2',
        defaultCurrency: 'EUR',
        settlementCurrency: 'EUR',
        status: 'ACTIVE',
        startDate: effectiveFrom,
        endDate: effectiveTo,
        config: {
          authority: {
            maxAdvanceInceptionDays: 90,
            maxPolicyPeriodMonths: 15,
            maxInsuredValue: 250000,
          },
          scope: { riskLocationCountries: ['Cyprus'] },
          documentation: { combinedCertificatesPermitted: true },
          financials: { grossPremiumIncomeLimit: 10000000, warningThresholdPercentage: 95 },
        },
        operatingTenantId: CY_TENANT.id,
      },
      select: { id: true },
    });
    binderId = binder.id;

    await prisma.programBinderLink.create({
      data: { programId, binderId, status: 'ACTIVE', mapping: {} },
    });
    await prisma.binderProductAuthority.create({
      data: {
        operatingTenantId: CY_TENANT.id,
        binderId,
        productCode: 'MOTOR',
        classOfBusiness: 'MOTOR',
        riskCode: 'MV',
        territorialScope: ['CY'],
        maxPolicyPeriodDays: 370,
        maxAdvanceInceptionDays: 90,
        authorityClasses: ['MOTOR'],
        status: 'ACTIVE',
        effectiveFrom,
        effectiveTo,
      },
    });
  });

  afterAll(async () => {
    // Cleanup policies created during suite
    for (const aggregateId of createdOutboxAggregateIds.reverse()) {
      await prisma.outbox.deleteMany({ where: { aggregateId } }).catch(() => undefined);
    }
    for (const id of createdPolicyIds.reverse()) {
      await prisma.policy.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdPolicyHolderIds.reverse()) {
      await prisma.policyHolder.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.programBinderLink.deleteMany({ where: { programId, binderId } }).catch(() => undefined);
    await prisma.binderProductAuthority.deleteMany({ where: { binderId, productCode: 'MOTOR' } }).catch(() => undefined);
    await prisma.binder.delete({ where: { id: binderId } }).catch(() => undefined);
    await prisma.program.delete({ where: { id: programId } }).catch(() => undefined);

    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }).catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    if (previousQuoteTokenSecret === undefined) delete process.env.QUOTE_TOKEN_SECRET;
    else process.env.QUOTE_TOKEN_SECRET = previousQuoteTokenSecret;
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    // Ensure we don't leak mocks into other tests
    vi.restoreAllMocks();
  });

  it('enforces uniqueness constraints in real Postgres (greenCardSerial)', async () => {
    const policyHolder = await prisma.policyHolder.create({
      data: {
        name: rnd('Integration PH2'),
        segment: 'Auto Insurance',
        address: 'Test Address',
        contact: '{}',
        operatingTenantId: CY_TENANT.id,
      },
      select: { id: true },
    });
    createdPolicyHolderIds.push(policyHolder.id);

    const inceptionDate = new Date();
    const expiryDate = new Date(inceptionDate);
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);

    const serial = rnd('GC');

    const firstPolicy = await prisma.policy.create({
      data: {
        policyNumber: rnd('ABQ'),
        productType: 'MOTOR',
        status: 'QUOTED',
        inceptionDate,
        expiryDate,
        policyHolderId: policyHolder.id,
        programId,
        binderId,
        greenCardSerial: serial,
        operatingTenantId: CY_TENANT.id,
      },
      select: { id: true },
    });
    createdPolicyIds.push(firstPolicy.id);

    await expect(
      prisma.policy.create({
        data: {
          policyNumber: rnd('ABQ'),
          productType: 'MOTOR',
          status: 'QUOTED',
          inceptionDate,
          expiryDate,
          policyHolderId: policyHolder.id,
          programId,
          binderId,
          greenCardSerial: serial,
          operatingTenantId: CY_TENANT.id,
        },
        select: { id: true },
      })
    ).rejects.toBeTruthy();
  });

  it('golden journey: HTTP rate -> bind issues policy processing state with persisted side effects', async () => {
    const createResponse = await fetch(`${baseUrl}/api/public/motor/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'customer' }),
    });
    const createPayload = await createResponse.json() as {
      error?: unknown;
      data?: { policyId?: string; publicSessionToken?: string };
    };
    expect(createResponse.status, JSON.stringify(createPayload.error)).toBe(200);
    const policyId = String(createPayload.data?.policyId || '');
    const publicSessionToken = String(createPayload.data?.publicSessionToken || '');
    expect(policyId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(publicSessionToken).not.toBe('');
    createdPolicyIds.push(policyId);
    createdOutboxAggregateIds.push(policyId);
    const createdPolicy = await prisma.policy.findUnique({
      where: { id: policyId },
      select: { policyHolderId: true },
    });
    if (createdPolicy?.policyHolderId) createdPolicyHolderIds.push(createdPolicy.policyHolderId);

    const rateResponse = await fetch(`${baseUrl}/api/public/motor/session/${publicSessionToken}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quoteData: motorGoldenFixtures.minimumValid }),
    });
    const ratePayload = await rateResponse.json() as {
      success?: boolean;
      error?: unknown;
      data?: { primaryOption?: { annualPremium?: number } };
    };
    expect(rateResponse.status, JSON.stringify(ratePayload.error)).toBe(200);
    expect(ratePayload.success).toBe(true);
    expect(Number(ratePayload.data?.primaryOption?.annualPremium || 0)).toBeGreaterThan(0);

    const bindResponse = await fetch(`${baseUrl}/api/policies/${policyId}/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    const bindPayload = await bindResponse.json() as {
      success?: boolean;
      error?: unknown;
      data?: { id?: string; status?: string; documentJobId?: string };
    };
    expect(bindResponse.status, JSON.stringify(bindPayload.error)).toBe(200);
    expect(bindPayload).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          id: policyId,
          status: 'ISSUING',
          documentJobId: expect.any(String),
        }),
      }),
    );

    const persistedPolicy = await prisma.policy.findUnique({
      where: { id: policyId },
      select: { status: true, policyNumber: true },
    });
    expect(String(persistedPolicy?.status || '')).toBe('ISSUING');
    // Motor on the Santam binder issues AB/ST/[<CC>/]<SEQ> (ADR-0061); a BO/HTTP
    // bind is the MANUAL stream, so CY yields AB/ST/1000100 (no country token).
    expect(String(persistedPolicy?.policyNumber || '')).toMatch(/^AB\/ST\/(?:[A-Z]{2}\/)?\d{7}$/);

    const inceptionRiskTx = await prisma.riskTransaction.findFirst({
      where: { policyId, transactionType: 'INCEPTION' },
      orderBy: { transactionNumber: 'desc' },
      select: { status: true, transactionType: true },
    });
    expect(String(inceptionRiskTx?.transactionType || '')).toBe('INCEPTION');
    expect(['PENDING_DOCS', 'BOUND']).toContain(String(inceptionRiskTx?.status || ''));

    const issuedInvoice = await prisma.invoice.findFirst({
      where: { policyId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    expect(Boolean(issuedInvoice?.id)).toBe(true);
    expect(String(issuedInvoice?.status || '')).not.toBe('');
  });
});

