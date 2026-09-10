import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { registerAllProducts } from '../../registerProducts.js';
import { ProductRegistry } from '../../../modules/policy/domain/ProductRegistry.js';
import { resolveImmutablePolicyDocumentConfiguration } from '../../../modules/policy/app/productRegistryService.js';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { TENANT_IDS, type TenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { fixtureProgrammeDefinition, fixtureRatingModelStages, fixtureRatingModelTables } from '../../programDefinitionFixtures.js';
import { buildDefaultProgramMbeProductConfig } from '../../../modules/mbe/domain/programProduct.js';

const RUN_INTEGRATION = String(process.env.INTEGRATION_TESTS || '').toLowerCase() === 'true';
registerAllProducts();

const ISSUED_DOC_PACK_ADAPTERS = ProductRegistry.getInstance()
  .getAllAdapters()
  .filter((adapter) => fixtureRatingModelTables(adapter.productType) !== null)
  .map((adapter) => [adapter.productType, adapter] as const);

const TEST_TENANT: TenantConfig = {
  id: TENANT_IDS.CY,
  tenantSlug: 'abbeygate-cy',
  countryCode: 'CY',
  country: 'Cyprus',
  currency: 'EUR',
  ipt: { flatFee: 0 },
  adminFee: 18,
  publicBaseUrl: 'https://abbeygate-cy.facio.io',
  fromEmail: 'no-reply@facio.io',
  brandLogo: { white: '', blue: '' },
  legalPack: 'cy',
};

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function addOneYear(date: Date): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

describe.runIf(RUN_INTEGRATION)('issued document pack generation (integration)', () => {
  const createdPolicyIds: string[] = [];
  const createdPolicyHolderIds: string[] = [];
  const createdProgramIds: string[] = [];
  const createdBinderIds: string[] = [];
  const createdBinderProductAuthorityIds: string[] = [];

  beforeAll(async () => {
    await prisma.tenant.upsert({
      where: { id: TEST_TENANT.id },
      update: {
        tenantSlug: TEST_TENANT.tenantSlug,
        status: 'ACTIVE',
        countryCode: TEST_TENANT.countryCode,
        country: TEST_TENANT.country,
        currency: TEST_TENANT.currency,
        iptJson: asInputJson(TEST_TENANT.ipt),
        adminFee: TEST_TENANT.adminFee,
        legalPack: TEST_TENANT.legalPack,
        publicBaseUrl: TEST_TENANT.publicBaseUrl,
        fromEmail: TEST_TENANT.fromEmail,
        brandLogos: asInputJson(TEST_TENANT.brandLogo),
        priorityCountries: ['Cyprus'],
        allowedRiskCountries: ['Cyprus', 'Spain', 'Portugal', 'Greece'],
        defaultNationality: 'Cyprus',
        defaultDriversLicenseCountry: 'Cyprus',
      },
      create: {
        id: TEST_TENANT.id,
        tenantSlug: TEST_TENANT.tenantSlug,
        kind: 'TEST',
        status: 'ACTIVE',
        countryCode: TEST_TENANT.countryCode,
        country: TEST_TENANT.country,
        currency: TEST_TENANT.currency,
        iptJson: asInputJson(TEST_TENANT.ipt),
        adminFee: TEST_TENANT.adminFee,
        legalPack: TEST_TENANT.legalPack,
        publicBaseUrl: TEST_TENANT.publicBaseUrl,
        fromEmail: TEST_TENANT.fromEmail,
        brandLogos: asInputJson(TEST_TENANT.brandLogo),
        priorityCountries: ['Cyprus'],
        allowedRiskCountries: ['Cyprus', 'Spain', 'Portugal', 'Greece'],
        defaultNationality: 'Cyprus',
        defaultDriversLicenseCountry: 'Cyprus',
      },
    });
  });

  afterAll(async () => {
    for (const policyId of [...createdPolicyIds].reverse()) {
      await tenantScopedPrisma.policy.delete({ where: { id: policyId } }).catch(() => undefined);
    }
    for (const policyHolderId of [...createdPolicyHolderIds].reverse()) {
      await tenantScopedPrisma.policyHolder.delete({ where: { id: policyHolderId } }).catch(() => undefined);
    }
    await prisma.programBinderLink.deleteMany({
      where: {
        programId: { in: createdProgramIds },
        binderId: { in: createdBinderIds },
      },
    }).catch(() => undefined);
    await tenantScopedPrisma.binderProductAuthorityProgramDefinition.deleteMany({
      where: { binderProductAuthorityId: { in: createdBinderProductAuthorityIds } },
    }).catch(() => undefined);
    await tenantScopedPrisma.binderProductAuthorityRatingModel.deleteMany({
      where: { binderProductAuthorityId: { in: createdBinderProductAuthorityIds } },
    }).catch(() => undefined);
    await tenantScopedPrisma.programDefinitionVersion.deleteMany({
      where: { programId: { in: createdProgramIds } },
    }).catch(() => undefined);
    await tenantScopedPrisma.programRatingModel.deleteMany({
      where: { programId: { in: createdProgramIds } },
    }).catch(() => undefined);
    await tenantScopedPrisma.binderProductAuthority.deleteMany({
      where: { id: { in: createdBinderProductAuthorityIds } },
    }).catch(() => undefined);
    for (const binderId of [...createdBinderIds].reverse()) {
      await tenantScopedPrisma.binder.delete({ where: { id: binderId } }).catch(() => undefined);
    }
    for (const programId of [...createdProgramIds].reverse()) {
      await tenantScopedPrisma.program.delete({ where: { id: programId } }).catch(() => undefined);
    }
    const [remainingSyntheticBinders, remainingSyntheticPrograms] = await Promise.all([
      createdBinderIds.length
        ? tenantScopedPrisma.binder.count({ where: { id: { in: createdBinderIds } } })
        : Promise.resolve(0),
      createdProgramIds.length
        ? tenantScopedPrisma.program.count({ where: { id: { in: createdProgramIds } } })
        : Promise.resolve(0),
    ]);
    expect(remainingSyntheticBinders).toBe(0);
    expect(remainingSyntheticPrograms).toBe(0);
    await prisma.$disconnect().catch(() => undefined);
  });

  it.each(ISSUED_DOC_PACK_ADAPTERS)(
    'generates and persists a complete issued pack for %s from product fixture data',
    async (_productType, adapter) => runWithOperatingTenant(TEST_TENANT, async () => {
      const fixture = adapter.getGoldenFixtures().minimumIssuable || adapter.getGoldenFixtures().minimumValid;
      const quoteData = structuredClone(fixture) as Record<string, unknown>;
      const fixtureDefinition = fixtureProgrammeDefinition(adapter.productType);
      const tables = fixtureRatingModelTables(adapter.productType);
      const stages = fixtureRatingModelStages(adapter.productType);
      const quote = await adapter.buildQuoteResponse(quoteData, tables ? {
        programDefinition: fixtureDefinition,
        ratingModel: {
          id: `${adapter.productType.toLowerCase()}-doc-pack-fixture-model`,
          programId: 'doc-pack-fixture-program',
          version: 1,
          binderProductAuthorityId: 'doc-pack-fixture-authority',
          stages,
          tables,
        },
      } : undefined);
      const quoteResponse = quote.quoteResponse as Record<string, unknown>;
      expect(quoteResponse).toBeTruthy();

      const inceptionDate = new Date('2026-05-01T00:00:00.000Z');
      const expiryDate = addOneYear(inceptionDate);
      const program = await tenantScopedPrisma.program.create({
        data: {
          name: unique(`${adapter.productType} Doc Pack Program`),
          productType: adapter.productType,
          status: 'ACTIVE',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2027-12-31T23:59:59.999Z'),
          metadata: asInputJson({}),
        },
        select: { id: true },
      });
      createdProgramIds.push(program.id);

      const binder = await tenantScopedPrisma.binder.create({
        data: {
          coverholderName: 'Abbeygate Insurance Brokers Limited',
          coverholderPin: '115933OFE',
          umr: unique(`B1760 ${adapter.productType}`),
          agreementNumber: unique(`${adapter.productType}-DOC`),
          lloydsReportingVer: 'V5.2',
          defaultCurrency: 'EUR',
          settlementCurrency: 'EUR',
          status: 'ACTIVE',
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2027-12-31T23:59:59.999Z'),
          config: asInputJson({}),
        },
        select: { id: true, umr: true },
      });
      createdBinderIds.push(binder.id);

      let snapshotProgramDefinition: ReturnType<typeof fixtureProgrammeDefinition> | null = null;

      await prisma.programBinderLink.create({
        data: { programId: program.id, binderId: binder.id, status: 'ACTIVE', mapping: asInputJson({}) },
      });
      if (tables) {
        const coverage = buildDefaultProgramMbeProductConfig({ productType: adapter.productType });
        const questionnaire = {
          requiredness: {},
          sections: [{
            id: 'risk',
            title: 'Risk details',
            questions: [{ key: 'risk.reference', label: 'Risk reference', type: 'text' }],
          }],
        };
        const workflow = { approvalRules: [], billing: {}, referralOnly: false, externalIssuance: { mode: 'NONE' } };
        const authority = await tenantScopedPrisma.binderProductAuthority.create({
          data: {
            binderId: binder.id,
            productCode: adapter.productType,
            classOfBusiness: adapter.productType,
            riskCode: `${adapter.productType}-DOC`,
            territorialScope: ['CY'],
            maxPolicyPeriodDays: 370,
            maxAdvanceInceptionDays: 90,
            authorityClasses: [adapter.productType],
            status: 'ACTIVE',
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            effectiveTo: new Date('2027-12-31T23:59:59.999Z'),
          },
          select: { id: true },
        });
        createdBinderProductAuthorityIds.push(authority.id);
        const ratingModel = await tenantScopedPrisma.programRatingModel.create({
          data: {
            programId: program.id,
            version: 1,
            status: 'PUBLISHED',
            name: `${adapter.productType} Doc Pack fixture model`,
            stages: asInputJson(stages),
            tables: asInputJson(tables),
            source: 'integration-test',
          },
          select: { id: true },
        });
        const definition = await tenantScopedPrisma.programDefinitionVersion.create({
          data: {
            programId: program.id,
            version: 1,
            status: 'PUBLISHED',
            pricingMode: 'AUTOMATED',
            programRatingModelId: ratingModel.id,
            underwriting: asInputJson(fixtureDefinition.underwriting),
            coverage: asInputJson(coverage),
            questionnaire: asInputJson(questionnaire),
            workflow: asInputJson(workflow),
            channels: asInputJson(fixtureDefinition.channels),
            documents: asInputJson(fixtureDefinition.documents),
            source: 'integration-test',
          },
          select: { id: true },
        });
        await tenantScopedPrisma.binderProductAuthorityRatingModel.create({
          data: {
            binderProductAuthorityId: authority.id,
            programRatingModelId: ratingModel.id,
          },
        });
        await tenantScopedPrisma.binderProductAuthorityProgramDefinition.create({
          data: {
            binderProductAuthorityId: authority.id,
            programDefinitionVersionId: definition.id,
          },
        });
        snapshotProgramDefinition = {
          ...fixtureDefinition,
          id: definition.id,
          programId: program.id,
          binderProductAuthorityId: authority.id,
          coverage,
          questionnaire,
          workflow,
        };
      }

      if (!snapshotProgramDefinition) {
        throw new Error(`Integration fixture requires a published programme definition for ${adapter.productType}.`);
      }

      const policyHolder = await tenantScopedPrisma.policyHolder.create({
        data: {
          name: `${adapter.productType} Fixture Customer`,
          segment: adapter.displayName,
          address: '1 Integration Street, Paphos, Cyprus',
          contact: JSON.stringify({ email: `docpack-${adapter.productType.toLowerCase()}@example.com`, phone: '+35799111222' }),
        },
        select: { id: true },
      });
      createdPolicyHolderIds.push(policyHolder.id);

      const policy = await tenantScopedPrisma.policy.create({
        data: {
          policyNumber: unique(`DOC-${adapter.productType}`),
          certificateNumber: unique(`CERT-${adapter.productType}`),
          productType: adapter.productType,
          status: 'ISSUING',
          inceptionDate,
          expiryDate,
          issuedAt: inceptionDate,
          policyHolderId: policyHolder.id,
          programId: program.id,
          binderId: binder.id,
          umr: binder.umr,
          quoteData: asInputJson(quoteData),
          quoteResponse: asInputJson(quoteResponse),
        },
        select: { id: true },
      });
      createdPolicyIds.push(policy.id);

      const snapshot = { quoteData, quoteResponse, programDefinition: snapshotProgramDefinition };
      const riskTransaction = await tenantScopedPrisma.riskTransaction.create({
        data: {
          policyId: policy.id,
          programId: program.id,
          binderId: binder.id,
          transactionNumber: 1,
          transactionType: 'INCEPTION',
          status: 'BOUND',
          effectiveDate: inceptionDate,
          expiryDate,
          changeReason: 'DOC_PACK_INTEGRATION',
          createdBy: 'integration-test',
          snapshotFinal: asInputJson(snapshot),
          pricingFinal: asInputJson(quoteResponse),
        },
        select: { id: true },
      });

      await tenantScopedPrisma.policyStateCurrent.create({
        data: {
          policyId: policy.id,
          snapshot: asInputJson(snapshot),
        },
      });
      const documentConfiguration = await resolveImmutablePolicyDocumentConfiguration({
        policyId: policy.id,
        riskTransactionId: riskTransaction.id,
      });

      const result = await adapter.generateDocPack({
        policyId: policy.id,
        riskTransactionId: riskTransaction.id,
        docPack: 'ISSUED_POLICY_PACK',
        source: 'SYSTEM',
        generatedByUserId: null,
        requiredIssuedDocTypes: documentConfiguration.requiredIssuedDocTypes,
        documentSources: documentConfiguration.documentSources,
        templateVersion: 'integration-test',
      });

      // A paid-policy recovery replay must reuse the active issued pack. It
      // must not supersede the documents it just created and expose a second
      // version to the customer portal.
      const replay = await adapter.generateDocPack({
        policyId: policy.id,
        riskTransactionId: riskTransaction.id,
        docPack: 'ISSUED_POLICY_PACK',
        source: 'SYSTEM',
        generatedByUserId: null,
        requiredIssuedDocTypes: documentConfiguration.requiredIssuedDocTypes,
        documentSources: documentConfiguration.documentSources,
        // A recovery can run after a product asset/template release. It must
        // retain the issued evidence instead of adding a second visible row
        // for every document type in the active issued pack.
        templateVersion: 'integration-test:recovery',
      });

      const requiredTypes = documentConfiguration.requiredIssuedDocTypes;
      const resultTypes = result.documents.map((doc) => doc.type);
      expect(resultTypes).toEqual(requiredTypes);
      expect(replay.version).toBe(result.version);
      expect(replay.documents.map((doc) => doc.type)).toEqual(requiredTypes);

      const rows = await tenantScopedPrisma.document.findMany({
        where: {
          policyId: policy.id,
          riskTransactionId: riskTransaction.id,
          docPack: 'ISSUED_POLICY_PACK',
          status: 'GENERATED',
          type: { in: requiredTypes },
        },
        select: { type: true, storageUri: true, filename: true, fileHash: true, templateVersion: true },
        orderBy: { type: 'asc' },
      });
      expect(rows).toHaveLength(requiredTypes.length);
      expect(new Set(rows.map((row) => row.type))).toEqual(new Set(requiredTypes));
      for (const row of rows) {
        expect(row.storageUri).toMatch(/^\/api\/documents\/.+\.pdf$/);
        expect(row.filename).toMatch(/\.pdf$/);
        expect(String(row.fileHash || '')).toMatch(/^[a-f0-9]{64}$/);
        expect(String(row.templateVersion || '')).toMatch(/^integration-test:/);
        expect(String(row.templateVersion || '')).not.toContain(':recovery:');
      }
    }),
    120_000,
  );
});
