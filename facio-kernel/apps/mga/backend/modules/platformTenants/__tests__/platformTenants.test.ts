import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { createPlatformTenantService, createReusableHomeTemplate, createReusableCommercialTemplate, createReusableTemplateCatalog, platformTenantProfileSchema } from '../index.js';
import { registerAllProducts } from '../../../products/registerProducts.js';
import { validateProgramDefinitionComponents } from '../../programs/app/programRuntimeDefinitions.js';
import { productDocumentsForProfile, runtimeSettingsForProfile } from '../infra/templates.js';
import { calculateHomePremium } from '../../../products/home/pricing/homeCalculator.js';
import type { HomeRates } from '../../../products/home/pricing/data/loader.js';
import { tenantRowToConfig } from '../../../platform/tenant/tenantConfigProjection.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { findLatestActiveBinderLinkForProduct } from '../../policy/app/binders/binderAuthority.js';

const profile = {
  displayName: 'Test MGA', legalName: 'Test MGA Synthetic Limited', locale: 'en-GB', timeZone: 'Asia/Nicosia',
  addressLines: ['Synthetic office'], declaredRole: 'MGA' as const,
  contactEmail: 'training@example.invalid', contactPhone: '+357 00000000', primaryColor: '#123456', secondaryColor: '#abcdef',
};
registerAllProducts();
describe('reusable tenant template', () => {
  it('validates every registered source product and limits unsupported Motor/Health territories', () => {
    const catalog = createReusableTemplateCatalog();
    for (const template of catalog) for (const item of [template, ...(template.additionalTemplates || [])]) {
      expect(() => validateProgramDefinitionComponents({ productType: item.product?.code || 'HOME', pricingMode: 'AUTOMATED', components: { ...item.configuration, documents: productDocumentsForProfile(profile, item) } as never }), item.view.id).not.toThrow();
      if (['MOTOR', 'HEALTH'].includes(item.product?.code || '')) expect(item.countryCode).toBe('CY');
    }
    expect(catalog.find(item => item.view.id === 'mga-cy-synthetic')!.view.productCodes).toEqual(['HOME', 'TRAVEL', 'HEALTH', 'MOTOR', 'COMMERCIAL']);
  });
  it('publishes the configured commercial percentage engine without reinterpreting its rate basis', async () => {
    const template = createReusableCommercialTemplate();
    const { calculateCommercial } = await import('../../../products/commercial/pricing.js');
    const { commercialGoldenFixtures } = await import('../../../products/commercial/goldenFixtures.js');
    const components = { underwriting: template.configuration.underwriting, coverage: template.configuration.coverage, questionnaire: template.configuration.questionnaire, workflow: template.configuration.workflow, channels: template.configuration.channels, documents: productDocumentsForProfile(profile, template) };
    expect(() => validateProgramDefinitionComponents({ productType: 'COMMERCIAL', pricingMode: 'AUTOMATED', components: components as never })).not.toThrow();
    const result = calculateCommercial(commercialGoldenFixtures.minimumValid, { programDefinition: { ...components, id: 'explicit-definition', programId: 'explicit-program', version: 1, pricingMode: 'AUTOMATED', binderProductAuthorityId: 'explicit-authority' }, ratingModel: { id: 'explicit-rating', version: 1, stages: template.configuration.ratingStages, tables: template.configuration.ratingTables } } as never, 'EUR');
    expect(result.premium).toBe(500);
  });
  it('publishes complete actual Home engine configuration and deterministic template identity', () => {
    const template = createReusableHomeTemplate();
    expect(createReusableHomeTemplate().view.hash).toBe(template.view.hash);
    expect(template.view.kind).toBe('SYNTHETIC');
    expect(() => validateProgramDefinitionComponents({ productType: 'HOME', pricingMode: 'AUTOMATED', components: {
      underwriting: template.configuration.underwriting, coverage: template.configuration.coverage,
      questionnaire: template.configuration.questionnaire, workflow: template.configuration.workflow,
      channels: template.configuration.channels, documents: productDocumentsForProfile(profile, template),
    } as never })).not.toThrow();
  });
  it('rejects unsupported authority, malformed locale/timezone and extra profile authority fields', () => {
    for (const changed of [{ declaredRole: 'INSURER' }, { locale: 'bad_locale' }, { timeZone: 'bad/time' }, { bindPermission: true }, { brandLogos: { white: 'file:///private', blue: 'https://example.invalid/a.svg' } }]) expect(platformTenantProfileSchema.safeParse({ ...profile, ...changed }).success).toBe(false);
  });
  it('retains explicit profile content and labels synthetic legal authority', () => {
    const settings = runtimeSettingsForProfile(profile);
    expect(settings.branding.legalName).toBe(profile.legalName);
    expect(settings.branding.secondaryColor).toBe(profile.secondaryColor);
    expect(settings.organization.declaredRole).toBe('MGA');
    expect(settings.branding.legalLines.join(' ')).toContain('No insurance cover');
  });
});

// Opt-in because this exercises actual non-bypass PostgreSQL. Every test-created row
// lives inside one rolled-back transaction; no global database cleanup is performed.
describe.runIf(process.env.PLATFORM_TENANT_PG_TEST === '1')('PostgreSQL platform provisioning', () => {
  it.runIf(process.env.PLATFORM_BROWSER_PG_TEST === '1')('reads the actual persisted browser workspace through exported scoped Prisma and canonical binder lookup', async () => {
    const { prisma, tenantScopedPrisma } = await import('../../../platform/db/connection.js');
    const row = await prisma.tenant.findFirstOrThrow({ where: { parentOrganizationId: '4a2de0b7-e6e4-4d07-95fb-f997dbe5b937', platformMemberships: { some: { user: { email: 'qa-builder@facio.invalid' }, active: true } } }, orderBy: { tenantSlug: 'asc' } });
    await runWithOperatingTenant(tenantRowToConfig(row), async () => {
      expect(await tenantScopedPrisma.program.count()).toBeGreaterThan(0);
      expect(await tenantScopedPrisma.settings.count()).toBe(1);
      const binder = await findLatestActiveBinderLinkForProduct({ productCode: 'HOME', inceptionDate: new Date() });
      expect(binder?.program.productType).toBe('HOME');
      expect(binder?.binderProductAuthority.status).toBe('ACTIVE');
    });
    await prisma.$disconnect();
  });
  it('isolates two builders and settings, persists working definitions, replays atomically and rejects stale/revoked access', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(['localhost', '127.0.0.1']).toContain(url.hostname);
    expect(url.pathname).toBe('/facio_gen2');
    const prisma = new PrismaClient({ log: [] });
    const rollback = new Error('intentional-test-rollback');
    const organizationId = '4a2de0b7-e6e4-4d07-95fb-f997dbe5b937';
    const prefix = `test-${randomUUID().slice(0, 8)}`;
    try {
      const [role] = await prisma.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
      await expect(prisma.$transaction(async (tx) => {
        const p = { $transaction: <T>(callback: (client: Prisma.TransactionClient) => Promise<T>) => callback(tx) } as unknown as PrismaClient;
        const service = createPlatformTenantService({ prisma: p, publicBaseUrl: 'https://platform.example.invalid', fromEmail: 'noreply@example.invalid' });
        const [a, b, admin] = await Promise.all(['amit@facio.io', 'yahav@facio.io', 'uriel@facio.io'].map((email) => tx.user.findUniqueOrThrow({ where: { email }, select: { id: true, role: true } })));
        expect([a!.role, b!.role, admin!.role]).toEqual(['UNDERWRITER', 'UNDERWRITER', 'UNDERWRITER']);
        const template = (await service.listTemplates(a!.id, organizationId)).templates.find(item => item.id === 'home-cy-synthetic')!;
        const input = { organizationId, templateId: template.id, templateVersion: template.version, templateHash: template.hash, jurisdiction: template.jurisdiction, currency: template.currency, tenantSlug: `${prefix}-alpha`, profile, idempotencyKey: randomUUID() };
        const actor = { userId: a!.id, correlationId: randomUUID() };
        const first = await service.provisionTenant(actor, input);
        const second = await service.provisionTenant({ ...actor, userId: b!.id }, { ...input, tenantSlug: `${prefix}-beta`, idempotencyKey: randomUUID() });
        expect(first.programs[0]!.status).toBe('ACTIVE');
        expect(await service.provisionTenant(actor, input)).toEqual(first);
        await expect(service.provisionTenant(actor, { ...input, profile: { ...profile, displayName: 'changed' } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
        await expect(service.provisionTenant(actor, { ...input, idempotencyKey: randomUUID(), jurisdiction: 'US' })).rejects.toMatchObject({ code: 'TEMPLATE_CONFIGURATION_MISMATCH' });
        await expect(service.resolveAccess(a!.id, second.tenant.tenantSlug)).rejects.toMatchObject({ code: 'PLATFORM_ACCESS_DENIED' });
        expect((await service.resolveAccess(admin!.id, first.tenant.tenantSlug)).role).toBe('ADMIN');
        expect((await service.listTenants(a!.id)).tenants.map((tenant) => tenant.id)).toContain(first.tenant.id);
        expect((await service.listTenants(a!.id)).tenants.map((tenant) => tenant.id)).not.toContain(second.tenant.id);
        const administratorPage = await service.listTenants(admin!.id, { take: 1, search: prefix });
        expect(administratorPage.hasMore).toBe(true);
        const nextPage = await service.listTenants(admin!.id, { take: 1, search: prefix, cursor: administratorPage.nextCursor! });
        expect(nextPage.hasMore).toBe(false);
        expect(new Set([...administratorPage.tenants, ...nextPage.tenants].map(item => item.id))).toEqual(new Set([first.tenant.id, second.tenant.id]));
        await expect(service.listTenants(a!.id, { take: 101 })).rejects.toThrow();

        await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${first.tenant.id}, true)`;
        expect(await tx.settings.count()).toBe(1);
        expect(await tx.settings.findFirst({ where: { operatingTenantId: second.tenant.id } })).toBeNull();
        expect(await tx.program.findUnique({ where: { id: second.programs[0]!.id } })).toBeNull();
        const definition = await tx.programDefinitionVersion.findFirstOrThrow({ where: { programId: first.programs[0]!.id }, include: { programRatingModel: true } });
        expect(definition.status).toBe('PUBLISHED');
        expect(definition.programRatingModel!.status).toBe('PUBLISHED');
        expect(await tx.binderProductAuthorityProgramDefinition.count()).toBe(1);
        const row = await tx.tenant.findUniqueOrThrow({ where: { id: first.tenant.id } });
        const rated = runWithOperatingTenant(tenantRowToConfig(row), () => calculateHomePremium({ propertyUse: 'Permanent', propertyType: 'Villa', buildingsSumInsured: 80_000, contentsSumInsured: 15_000, alarm: true, yearBuilt: 'Prior to 1980', previousClaims: 'None', noClaimsDiscount: '0 Years', increasedExcess: 'STD 150 XS', proposerOver45: false, europAssistance: false }, definition.programRatingModel!.tables as unknown as HomeRates));
        expect(rated.breakdown.grossPremium).toBeGreaterThan(0);
        const thread = await tx.communicationThread.create({ data: { entityType: 'ACCOUNT', entityId: first.tenant.accountId } });
        const message = await tx.communicationMessage.create({ data: { threadId: thread.id, direction: 'INTERNAL', channel: 'NOTE', provider: 'SYSTEM', fromActor: a!.id, toRecipients: [], body: 'Private Alpha synthetic note', status: 'LOGGED' } });
        await tx.communicationTemplate.create({ data: { name: 'Alpha private template', channel: 'EMAIL', bodyTemplate: 'Alpha only', variablesSchema: {} } });
        await tx.communicationParticipant.create({ data: { entityType: 'ACCOUNT', entityId: first.tenant.accountId, contactName: 'Alpha only', contactRole: 'BROKER', email: 'alpha@example.invalid' } });
        await tx.communicationDeliveryAttempt.create({ data: { messageId: message.id, provider: 'SYSTEM', channel: 'NOTE', status: 'LOGGED' } });
        await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${second.tenant.id}, true)`;
        expect(await tx.communicationThread.count()).toBe(0);
        expect(await tx.communicationMessage.findUnique({ where: { id: message.id } })).toBeNull();
        expect(await tx.communicationTemplate.count()).toBe(0);
        expect(await tx.communicationParticipant.count()).toBe(0);
        expect(await tx.communicationDeliveryAttempt.count()).toBe(0);
        await tx.$executeRawUnsafe('SAVEPOINT forbidden_cross_tenant_child');
        await expect(tx.communicationMessage.create({ data: { threadId: thread.id, direction: 'INTERNAL', channel: 'NOTE', provider: 'SYSTEM', fromActor: b!.id, toRecipients: [], body: 'Forbidden', status: 'LOGGED' } })).rejects.toMatchObject({ code: 'P2003' });
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT forbidden_cross_tenant_child');
        await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${first.tenant.id}, true)`;
        expect(await tx.communicationMessage.count()).toBe(1);
        const edit = { tenantId: first.tenant.id, expectedVersion: 1, profile: { ...profile, displayName: 'Updated Synthetic MGA' }, idempotencyKey: randomUUID() };
        const updated = await service.updateProfile(actor, edit);
        expect(updated.version).toBe(2);
        expect(await service.updateProfile(actor, edit)).toEqual(updated);
        await expect(service.updateProfile(actor, { ...edit, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
        const portfolioTemplate = (await service.listTemplates(a!.id, organizationId)).templates.find(item => item.id === 'mga-cy-synthetic')!;
        const portfolio = await service.provisionTenant(actor, { ...input, tenantSlug: `${prefix}-portfolio`, idempotencyKey: randomUUID(), templateId: portfolioTemplate.id, templateVersion: portfolioTemplate.version, templateHash: portfolioTemplate.hash });
        expect(portfolio.template).toEqual({ id: portfolioTemplate.id, version: portfolioTemplate.version, hash: portfolioTemplate.hash });
        expect(portfolio.programs.map(item => item.productCode)).toEqual(['HOME', 'TRAVEL', 'HEALTH', 'MOTOR', 'COMMERCIAL']);
        await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${portfolio.tenant.id}, true)`;
        expect(await tx.program.count()).toBe(5);
        expect(await tx.programDefinitionVersion.count({ where: { status: 'PUBLISHED' } })).toBe(5);
        expect(await tx.binderProductAuthorityProgramDefinition.count()).toBe(5);
        const commercialProgram = portfolio.programs.find(item => item.productCode === 'COMMERCIAL')!;
        const commercialDefinition = await tx.programDefinitionVersion.findFirstOrThrow({ where: { programId: commercialProgram.id }, include: { programRatingModel: true } });
        const { calculateCommercial } = await import('../../../products/commercial/pricing.js');
        const { commercialGoldenFixtures } = await import('../../../products/commercial/goldenFixtures.js');
        const commercialResult = calculateCommercial(commercialGoldenFixtures.minimumValid, { programDefinition: commercialDefinition, ratingModel: commercialDefinition.programRatingModel } as never, 'EUR');
        expect(commercialResult.premium).toBe(500);
        await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${first.tenant.id}, true)`;
        await tx.platformTenantMembership.update({ where: { operatingTenantId_userId: { operatingTenantId: first.tenant.id, userId: a!.id } }, data: { active: false, version: { increment: 1 } } });
        await expect(service.resolveAccess(a!.id, first.tenant.tenantSlug)).rejects.toMatchObject({ code: 'PLATFORM_ACCESS_DENIED' });
        await expect(service.provisionTenant(actor, input)).rejects.toMatchObject({ code: 'PLATFORM_ACCESS_DENIED' });
        await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', '', true)`;
        expect(await tx.settings.count()).toBe(0);
        expect(await tx.program.count()).toBe(0);
        throw rollback;
      }, { timeout: 30_000 })).rejects.toBe(rollback);
      expect(await prisma.tenant.count({ where: { tenantSlug: { startsWith: prefix } } })).toBe(0);
    } finally { await prisma.$disconnect(); }
  }, 40_000);
});
