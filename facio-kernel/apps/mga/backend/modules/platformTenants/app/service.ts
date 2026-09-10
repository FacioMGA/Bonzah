import { randomUUID } from 'node:crypto';
import { createReusableTemplateCatalog } from '../infra/sourceTemplates.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  PlatformTenantError, platformTenantProfileSchema, provisionPlatformTenantSchema, platformPageSchema, type PlatformPageInput,
  type PlatformActor, type PlatformOrganizationRole, type PlatformProvisioningResult,
  type PlatformTenantAccess, type PlatformTenantProfile, type PlatformTenantRole, type PlatformTenantView,
} from '../domain/contracts.js';
import {
  contentHash, json, productDocumentsForProfile,
  runtimeSettingsForProfile, type ReusableTenantTemplate,
} from '../infra/templates.js';
import { parseTenantRuntimeSettings } from '../../../platform/tenant/tenantRuntimeSettings.js';
import { validateProgramDefinitionComponents, validateProgramRatingModel } from '../../programs/app/programRuntimeDefinitions.js';

type Tx = Prisma.TransactionClient;
type Options = { prisma: PrismaClient; templates?: readonly ReusableTenantTemplate[]; publicBaseUrl: string; fromEmail: string };
const inputJson = (value: unknown): Prisma.InputJsonValue => json(value) as Prisma.InputJsonValue;
const denied = () => new PlatformTenantError('PLATFORM_ACCESS_DENIED', 'Active organization and tenant membership are required');
const updateSchema = z.object({ tenantId: z.string().uuid(), expectedVersion: z.number().int().positive(), profile: platformTenantProfileSchema, idempotencyKey: z.string().uuid() }).strict();

/** The injected client connects only to the new platform PostgreSQL database. No customer source is queried. */
export function createPlatformTenantService(options: Options) {
  return new PlatformTenantService(options);
}

export class PlatformTenantService {
  private readonly templates: Map<string, ReusableTenantTemplate>;
  constructor(private readonly options: Options) {
    const supplied = options.templates ?? createReusableTemplateCatalog();
    this.templates = new Map(supplied.map((template) => [`${template.view.id}:${template.view.version}`, structuredClone(template)]));
    if (this.templates.size !== supplied.length) throw new Error('Duplicate platform tenant template identity');
    z.string().url().parse(options.publicBaseUrl);
    z.string().email().parse(options.fromEmail);
  }
  private async activeUser(tx: Tx, userId: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, suspendedAt: true, role: true } });
    if (!user || !user.isActive || user.suspendedAt || user.role === 'CUSTOMER') throw denied();
    return user;
  }
  private async organization(tx: Tx, userId: string, organizationId: string, manage = false) {
    await this.activeUser(tx, userId);
    const membership = await tx.platformOrganizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } }, include: { organization: true },
    });
    if (!membership?.active || !membership.organization.active || !['OWNER', 'ADMIN', 'BUILDER'].includes(membership.role)) throw denied();
    if (manage && !['OWNER', 'ADMIN'].includes(membership.role)) throw denied();
    return membership;
  }
  private async access(tx: Tx, userId: string, selector: { tenantSlug: string } | { id: string }): Promise<PlatformTenantAccess> {
    await this.activeUser(tx, userId);
    const tenant = await tx.tenant.findUnique({ where: selector });
    if (!tenant?.parentOrganizationId || tenant.kind !== 'SYNTHETIC' || tenant.status !== 'ACTIVE') throw denied();
    await this.organization(tx, userId, tenant.parentOrganizationId);
    const membership = await tx.platformTenantMembership.findUnique({ where: { operatingTenantId_userId: { operatingTenantId: tenant.id, userId } } });
    if (!membership?.active || !['ADMIN', 'UNDERWRITER'].includes(membership.role)) throw denied();
    const settings = parseTenantRuntimeSettings(tenant.runtimeSettings);
    const logos = tenant.brandLogos;
    const profile = platformTenantProfileSchema.parse({
      displayName: settings.branding.displayName, contactEmail: settings.contact.email, contactPhone: settings.contact.phone,
      legalName: settings.branding.legalName, addressLines: settings.branding.addressLines,
      locale: settings.locale, timeZone: settings.timeZone, declaredRole: settings.organization.declaredRole,
      ...(logos && typeof logos === 'object' && !Array.isArray(logos) && logos.white && logos.blue ? { brandLogos: logos } : {}),
      ...('primaryColor' in settings.branding && settings.branding.primaryColor ? { primaryColor: settings.branding.primaryColor } : {}),
      ...('secondaryColor' in settings.branding && settings.branding.secondaryColor ? { secondaryColor: settings.branding.secondaryColor } : {}),
    });
    return { id: tenant.id, organizationId: tenant.parentOrganizationId, tenantSlug: tenant.tenantSlug, kind: 'SYNTHETIC', status: tenant.status,
      role: membership.role as PlatformTenantRole, accountId: membership.accountId, version: tenant.runtimeSettingsVersion, profile,
      userId, membershipVersion: membership.version };
  }
  async resolveAccess(userId: string, tenantSlug: string) {
    return this.options.prisma.$transaction((tx) => this.access(tx, userId, { tenantSlug }));
  }
  async listOrganizations(userId: string, input: PlatformPageInput = {}) {
    const page = platformPageSchema.parse(input);
    return this.options.prisma.$transaction(async (tx) => {
      await this.activeUser(tx, userId);
      const rows = await tx.platformOrganizationMembership.findMany({ where: { userId, active: true, ...(page.cursor ? { organizationId: { gt: page.cursor } } : {}), organization: { active: true, ...(page.search ? { OR: [{ name: { contains: page.search, mode: 'insensitive' } }, { slug: { contains: page.search, mode: 'insensitive' } }] } : {}) } }, include: { organization: true }, orderBy: { organizationId: 'asc' }, take: page.take + 1 });
      return { organizations: rows.slice(0, page.take).map((row) => ({ id: row.organizationId, slug: row.organization.slug, name: row.organization.name, role: row.role as PlatformOrganizationRole })), hasMore: rows.length > page.take, nextCursor: rows.length > page.take ? rows[page.take - 1]!.organizationId : null };
    });
  }
  async listTenants(userId: string, input: PlatformPageInput = {}) {
    const page = platformPageSchema.parse(input);
    return this.options.prisma.$transaction(async (tx) => {
      await this.activeUser(tx, userId);
      const memberships = await tx.platformTenantMembership.findMany({ where: { userId, active: true, ...(page.cursor ? { operatingTenantId: { gt: page.cursor } } : {}), operatingTenant: { status: 'ACTIVE', kind: 'SYNTHETIC', ...(page.search ? { OR: [{ tenantSlug: { contains: page.search, mode: 'insensitive' } }, { defaultBrokerName: { contains: page.search, mode: 'insensitive' } }] } : {}), parentOrganization: { active: true, memberships: { some: { userId, active: true } } } } }, orderBy: { operatingTenantId: 'asc' }, take: page.take + 1 });
      const tenants: PlatformTenantView[] = [];
      for (const membership of memberships.slice(0, page.take)) {
        const { userId: _, membershipVersion: __, ...view } = await this.access(tx, userId, { id: membership.operatingTenantId });
        tenants.push(view);
      }
      return { tenants, hasMore: memberships.length > page.take, nextCursor: memberships.length > page.take ? memberships[page.take - 1]!.operatingTenantId : null };
    });
  }
  async listTemplates(userId: string, organizationId: string) {
    await this.options.prisma.$transaction((tx) => this.organization(tx, userId, organizationId));
    return { templates: [...this.templates.values()].map((template) => structuredClone(template.view)) };
  }
  async getProfile(userId: string, tenantId: string) {
    const access = await this.options.prisma.$transaction((tx) => this.access(tx, userId, { id: tenantId }));
    return { version: access.version, profile: access.profile };
  }
  private async tenantContext(tx: Tx, tenantId: string, accountId: string) {
    await tx.$executeRaw`SELECT set_config('app.operating_tenant_id', ${tenantId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_account_id', ${accountId}, true)`;
  }
  private async audit(tx: Tx, actor: PlatformActor, tenantId: string, operation: string, data: object) {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const payload = { eventId, eventType: operation, aggregateType: 'ACCOUNT', aggregateId: tenantId, aggregateVersion: 1, actorType: 'USER', actorId: actor.userId, correlationId: actor.correlationId, occurredAt, data };
    await tx.auditAction.create({ data: { operatingTenantId: tenantId, actorType: 'USER', actorId: actor.userId, actionName: operation, entityType: 'TENANT', entityId: tenantId, diff: inputJson(payload), hash: contentHash(payload) } });
    await tx.outbox.create({ data: { operatingTenantId: tenantId, eventId, aggregateId: tenantId, eventType: operation, payload: inputJson(payload) } });
  }
  async provisionTenant(actor: PlatformActor, raw: unknown): Promise<PlatformProvisioningResult> {
    const input = provisionPlatformTenantSchema.parse(raw);
    const template = this.templates.get(`${input.templateId}:${input.templateVersion}`);
    if (!template || template.view.hash !== input.templateHash) throw new PlatformTenantError('TEMPLATE_CHANGED', 'Select the exact registered template version and hash', 409);
    if (input.jurisdiction !== template.view.jurisdiction || input.currency !== template.view.currency) throw new PlatformTenantError('TEMPLATE_CONFIGURATION_MISMATCH', 'Jurisdiction and currency must match the selected template', 422);
    const requestHash = contentHash(input);
    return this.options.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-provision:${input.organizationId}:${input.idempotencyKey}`}, 0))`;
      await this.organization(tx, actor.userId, input.organizationId);
      const prior = await tx.platformTenantProvisioning.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } } });
      if (prior) {
        if (prior.requestHash !== requestHash) throw new PlatformTenantError('IDEMPOTENCY_CONFLICT', 'The key belongs to another provisioning request', 409);
        if (contentHash(prior.result) !== prior.resultHash) throw new PlatformTenantError('INTEGRITY_ERROR', 'Provisioning evidence failed integrity verification', 500);
        await this.access(tx, actor.userId, { id: prior.operatingTenantId });
        return prior.result as unknown as PlatformProvisioningResult;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-tenant-slug:${input.tenantSlug}`}, 0))`;
      if (await tx.tenant.findUnique({ where: { tenantSlug: input.tenantSlug }, select: { id: true } })) throw new PlatformTenantError('TENANT_SLUG_EXISTS', 'The tenant slug is already registered', 409);
      const id = randomUUID(), accountId = randomUUID();
      const settings = runtimeSettingsForProfile(input.profile);
      await tx.tenant.create({ data: {
        id, tenantSlug: input.tenantSlug, parentOrganizationId: input.organizationId, kind: 'SYNTHETIC', status: 'ACTIVE',
        countryCode: template.countryCode, country: template.country, currency: template.currency, legalPack: template.legalPack,
        iptJson: { flatFee: 0 }, adminFee: 0, publicBaseUrl: this.options.publicBaseUrl, fromEmail: this.options.fromEmail,
        priorityCountries: [template.country], allowedRiskCountries: [template.country], defaultNationality: 'United Kingdom', defaultDriversLicenseCountry: template.country,
        defaultBrokerName: input.profile.displayName, brandLogos: input.profile.brandLogos ? inputJson(input.profile.brandLogos) : Prisma.JsonNull,
        authority: inputJson(Object.fromEntries([template, ...(template.additionalTemplates || [])].map(item => [item.product?.code || 'HOME', item.configuration.underwriting]))), runtimeSettings: inputJson(settings),
      } });
      await this.tenantContext(tx, id, accountId);
      await tx.account.create({ data: { id: accountId, operatingTenantId: id, name: input.profile.displayName, kind: 'INTERNAL' } });
      await tx.settings.create({ data: { operatingTenantId: id, defaultRate: 0.23, commissions: JSON.stringify({ retailBroker: 10, broker: 10, mga: 80 }) } });
      await tx.accountUser.create({ data: { accountId, userId: actor.userId, role: 'OWNER' } });
      await tx.platformTenantMembership.create({ data: { operatingTenantId: id, userId: actor.userId, accountId, role: 'ADMIN' } });
      const administrators = await tx.platformOrganizationMembership.findMany({ where: { organizationId: input.organizationId, active: true, role: { in: ['OWNER', 'ADMIN'] }, userId: { not: actor.userId }, user: { isActive: true, suspendedAt: null } } });
      for (const administrator of administrators) {
        await tx.platformTenantMembership.create({ data: { operatingTenantId: id, userId: administrator.userId, accountId, role: 'ADMIN' } });
        await tx.accountUser.create({ data: { accountId, userId: administrator.userId, role: 'OWNER' } });
      }
      const programs = [];
      for (const item of [template, ...(template.additionalTemplates || [])]) programs.push(...await this.provisionProgram(tx, id, input.profile, item));
      const tenant: PlatformTenantView = { id, organizationId: input.organizationId, tenantSlug: input.tenantSlug, kind: 'SYNTHETIC', status: 'ACTIVE', role: 'ADMIN', accountId, version: 1, profile: input.profile };
      const body = { tenant, template: { id: template.view.id, version: template.view.version, hash: template.view.hash }, programs, requestHash };
      const result = { ...body, receiptHash: contentHash(body) };
      await tx.platformTenantProvisioning.create({ data: { organizationId: input.organizationId, operatingTenantId: id, actorId: actor.userId, idempotencyKey: input.idempotencyKey, requestHash, templateId: template.view.id, templateVersion: template.view.version, templateHash: template.view.hash, result: inputJson(result), resultHash: contentHash(result) } });
      await this.audit(tx, actor, id, 'PLATFORM.TENANT_PROVISIONED', { template: result.template, receiptHash: result.receiptHash });
      return result;
    }, { timeout: 20_000 });
  }
  private async provisionProgram(tx: Tx, tenantId: string, profile: PlatformTenantProfile, template: ReusableTenantTemplate) {
    const specification = template.product || { code: 'HOME', name: 'Home insurance', icon: 'home', classOfBusiness: 'PROPERTY', riskCode: 'HH', programCode: 'abbeygate_home' };
    const productCode = specification.code;
    const product = await tx.productDefinition.upsert({ where: { code: productCode }, create: { code: productCode, displayName: specification.name, icon: specification.icon }, update: {} });
    if (!product.isActive) throw new PlatformTenantError('PRODUCT_DISABLED', 'The registered product is disabled', 409);
    const definition = { underwriting: inputJson(template.configuration.underwriting), coverage: inputJson(template.configuration.coverage), questionnaire: inputJson(template.configuration.questionnaire), workflow: inputJson(template.configuration.workflow), channels: inputJson(template.configuration.channels), documents: inputJson(productDocumentsForProfile(profile, template)) };
    validateProgramDefinitionComponents({ productType: productCode, pricingMode: 'AUTOMATED', components: definition as Prisma.JsonObject as never });
    const start = new Date(); start.setUTCDate(start.getUTCDate() - 1); start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + 2);
    const program = await tx.program.create({ data: { operatingTenantId: tenantId, name: `${profile.displayName} ${specification.name}`, productType: productCode, status: 'ACTIVE', effectiveFrom: start, effectiveTo: end, metadata: { platformTemplateId: template.view.id, platformTemplateHash: template.view.hash, synthetic: true } } });
    const binder = await tx.binder.create({ data: { operatingTenantId: tenantId, coverholderName: `${profile.displayName} — synthetic`, umr: `SYNTHETIC-${tenantId}-${productCode}`, agreementNumber: `TRAINING-${tenantId}-${productCode}`, defaultCurrency: template.currency, settlementCurrency: template.currency, status: 'ACTIVE', startDate: start, endDate: end, config: { productType: productCode, scope: { authorizedClass: specification.name, riskLocationCountries: [template.countryCode, template.country] }, synthetic: true, authority: { maxPolicyPeriodMonths: 12, maxAdvanceInceptionDays: 90 } } } });
    await tx.programBinderLink.create({ data: { programId: program.id, binderId: binder.id, status: 'ACTIVE' } });
    const authority = await tx.binderProductAuthority.create({ data: { operatingTenantId: tenantId, binderId: binder.id, productCode, classOfBusiness: specification.classOfBusiness, riskCode: specification.riskCode, territorialScope: [template.countryCode], authorityClasses: [], status: 'ACTIVE', effectiveFrom: start, effectiveTo: end, notes: 'SYNTHETIC training authority only. No insurer delegation.' } });
    const model = await tx.programRatingModel.create({ data: { operatingTenantId: tenantId, programId: program.id, version: 1, status: 'PUBLISHED', name: `Pinned ${specification.name} training rates`, stages: inputJson(template.configuration.ratingStages || []), tables: inputJson(template.configuration.ratingTables), source: `platform-template:${template.view.id}:v${template.view.version}:${template.view.hash}` } });
    validateProgramRatingModel(productCode, { id: model.id, programId: program.id, version: model.version, binderProductAuthorityId: authority.id, stages: model.stages, tables: model.tables });
    const published = await tx.programDefinitionVersion.create({ data: { operatingTenantId: tenantId, programId: program.id, version: 1, status: 'PUBLISHED', pricingMode: 'AUTOMATED', programRatingModelId: model.id, ...definition, source: `platform-template:${template.view.id}:v${template.view.version}:${template.view.hash}` } });
    await tx.binderProductAuthorityRatingModel.create({ data: { binderProductAuthorityId: authority.id, programRatingModelId: model.id } });
    await tx.binderProductAuthorityProgramDefinition.create({ data: { operatingTenantId: tenantId, binderProductAuthorityId: authority.id, programDefinitionVersionId: published.id } });
    return [{ id: program.id, name: program.name, productCode, status: program.status, binderId: binder.id }];
  }
  async updateProfile(actor: PlatformActor, raw: unknown) {
    const input = updateSchema.parse(raw);
    const requestHash = contentHash(input);
    return this.options.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-profile:${input.tenantId}`}, 0))`;
      const access = await this.access(tx, actor.userId, { id: input.tenantId });
      if (access.role !== 'ADMIN') throw denied();
      const key = { organizationId: access.organizationId, operation: 'profile', idempotencyKey: input.idempotencyKey };
      const prior = await tx.platformTenantCommand.findUnique({ where: { organizationId_operation_idempotencyKey: key } });
      if (prior) {
        if (prior.requestHash !== requestHash) throw new PlatformTenantError('IDEMPOTENCY_CONFLICT', 'The key belongs to another profile update', 409);
        if (contentHash(prior.result) !== prior.resultHash) throw new PlatformTenantError('INTEGRITY_ERROR', 'Profile receipt failed integrity verification', 500);
        return prior.result as unknown as { version: number; profile: PlatformTenantProfile };
      }
      if (input.expectedVersion !== access.version) throw new PlatformTenantError('VERSION_CONFLICT', 'The tenant profile changed; reload before saving', 409);
      const result = { version: access.version + 1, profile: input.profile };
      const changed = await tx.tenant.updateMany({ where: { id: input.tenantId, runtimeSettingsVersion: access.version }, data: { runtimeSettings: inputJson(runtimeSettingsForProfile(input.profile)), runtimeSettingsVersion: result.version, defaultBrokerName: input.profile.displayName, brandLogos: input.profile.brandLogos ? inputJson(input.profile.brandLogos) : Prisma.JsonNull } });
      if (changed.count !== 1) throw new PlatformTenantError('VERSION_CONFLICT', 'The tenant profile changed; reload before saving', 409);
      await this.tenantContext(tx, access.id, access.accountId);
      await this.audit(tx, actor, access.id, 'PLATFORM.TENANT_PROFILE_UPDATED', { version: result.version, profileHash: contentHash(input.profile) });
      await tx.platformTenantCommand.create({ data: { ...key, actorId: actor.userId, requestHash, result: inputJson(result), resultHash: contentHash(result) } });
      return result;
    });
  }
  async bootstrapOrganization(input: { organizationId: string; slug: string; name: string; ownerUserId: string }) {
    return this.options.prisma.$transaction(async (tx) => {
      await this.activeUser(tx, input.ownerUserId);
      const prior = await tx.platformOrganization.findUnique({ where: { id: input.organizationId } });
      if (prior) {
        await this.organization(tx, input.ownerUserId, prior.id, true);
        if (prior.slug !== input.slug || prior.name !== input.name) throw new PlatformTenantError('BOOTSTRAP_CONFLICT', 'Existing organization differs from the explicit bootstrap', 409);
        return prior;
      }
      const organization = await tx.platformOrganization.create({ data: { id: input.organizationId, slug: input.slug, name: input.name } });
      await tx.platformOrganizationMembership.create({ data: { organizationId: organization.id, userId: input.ownerUserId, role: 'OWNER' } });
      return organization;
    });
  }
}
