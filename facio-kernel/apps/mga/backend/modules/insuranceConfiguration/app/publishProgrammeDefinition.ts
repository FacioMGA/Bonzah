import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { validateProgramDefinitionComponents, validateProgramRatingModel } from '../../programs/app/programRuntimeDefinitions.js';
import { InsuranceConfigurationError } from '../domain/runtimeConfiguration.js';
import { definitionHash } from '../infra/programmeRepository.js';
import { assertRetainedScopeBindings, readProgrammeScopeBindings } from '../infra/questionScopeBindings.js';
import { binderScopesSchema } from '../domain/questionScopes.js';

export type PublishProgrammeActor = { tenantId: string; userId: string; permissions: string[] };
/** Canonical publication for BO and Config MCP. Validation, mapping and audit commit together. */
export async function publishProgrammeDefinition(args: { programId: string; definitionId: string; expectedDefinitionHash?: string; binderProductAuthorityIds: string[] }, actor: PublishProgrammeActor) {
  const tenantId = getTenantConfig().id;
  if (actor.tenantId !== tenantId || !actor.userId || !actor.permissions.some((permission) => permission === 'programs.publish' || permission === 'configuration.publish_sandbox')) throw new InsuranceConfigurationError('Publication requires an authorized actor in this operating tenant.');
  if (!args.binderProductAuthorityIds.length || new Set(args.binderProductAuthorityIds).size !== args.binderProductAuthorityIds.length) throw new InsuranceConfigurationError('Select distinct binder product authorities.');
  return runTenantScopedTransaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM programs WHERE id = ${args.programId} AND "operatingTenantId" = ${tenantId} FOR UPDATE`;
    if (locked.length !== 1) throw new InsuranceConfigurationError('Programme is unavailable in this operating tenant.');
    await tx.$queryRaw`SELECT id FROM program_definition_versions WHERE id = ${args.definitionId} AND "operatingTenantId" = ${tenantId} FOR UPDATE`;
    const definition = await tx.programDefinitionVersion.findFirst({ where: { id: args.definitionId, programId: args.programId, operatingTenantId: tenantId }, include: { program: { select: { productType: true } }, programRatingModel: { select: { id: true, operatingTenantId: true, programId: true, version: true, stages: true, tables: true, status: true } } } });
    if (!definition) throw new InsuranceConfigurationError('Programme definition is unavailable in this operating tenant.');
    const hash = definitionHash(definition);
    if (args.expectedDefinitionHash && hash !== args.expectedDefinitionHash) throw new InsuranceConfigurationError('STALE_DEFINITION: publication must use the exact reviewed definition hash.');
    const authorities = await tx.binderProductAuthority.findMany({ where: { id: { in: args.binderProductAuthorityIds }, operatingTenantId: tenantId, status: 'ACTIVE', productCode: String(definition.program.productType || '').trim().toUpperCase(), binder: { operatingTenantId: tenantId, status: 'ACTIVE', programLinks: { some: { programId: args.programId, status: 'ACTIVE' } } } }, select: { id: true, ratingModelMapping: { select: { programRatingModelId: true } }, programDefinitionMapping: { select: { programDefinitionVersionId: true } } } });
    if (authorities.length !== args.binderProductAuthorityIds.length) throw new InsuranceConfigurationError('Every selected authority must be active, match this product, and belong to an active binder link in this operating tenant.');
    if (definition.status === 'PUBLISHED' && args.expectedDefinitionHash && authorities.every((authority) => authority.programDefinitionMapping?.programDefinitionVersionId === definition.id)) return definition;
    if (definition.status !== 'DRAFT') throw new InsuranceConfigurationError('Only a draft definition can be newly published.');
    const questionnaire = definition.questionnaire as Prisma.JsonObject;
    if (questionnaire.sourceCompilerVersion === 4) {
      const retained = binderScopesSchema.parse(questionnaire.sourceScopeBindings);
      assertRetainedScopeBindings(retained, await readProgrammeScopeBindings(tx, tenantId, args.programId, String(definition.program.productType || '')));
    }
    validateProgramDefinitionComponents({ productType: String(definition.program.productType || ''), pricingMode: definition.pricingMode as 'AUTOMATED' | 'MANUAL', components: { underwriting: definition.underwriting as Prisma.JsonObject, coverage: definition.coverage as Prisma.JsonObject, questionnaire: definition.questionnaire as Prisma.JsonObject, workflow: definition.workflow as Prisma.JsonObject, channels: definition.channels as Prisma.JsonObject, documents: definition.documents as Prisma.JsonObject } });
    if (definition.pricingMode === 'AUTOMATED') {
      const model = definition.programRatingModel;
      if (!model || model.status !== 'PUBLISHED' || model.operatingTenantId !== tenantId || model.programId !== args.programId) throw new InsuranceConfigurationError('An automated definition requires its published rating model in this programme and tenant.');
      for (const authority of authorities) {
        if (authority.ratingModelMapping?.programRatingModelId !== model.id) throw new InsuranceConfigurationError('Publish the selected rating model to every target binder product authority first.');
        validateProgramRatingModel(String(definition.program.productType || ''), { ...model, binderProductAuthorityId: authority.id });
      }
    }
    const published = await tx.programDefinitionVersion.update({ where: { id: definition.id, operatingTenantId: tenantId, status: 'DRAFT' }, data: { status: 'PUBLISHED' }, include: { program: { select: { productType: true } } } });
    for (const authority of authorities) await tx.binderProductAuthorityProgramDefinition.upsert({ where: { binderProductAuthorityId: authority.id }, update: { programDefinitionVersionId: published.id }, create: { operatingTenantId: tenantId, binderProductAuthorityId: authority.id, programDefinitionVersionId: published.id } });
    const diff = { definitionId: published.id, version: published.version, definitionHash: hash, binderProductAuthorityIds: authorities.map((authority) => authority.id).sort() };
    const event = { operatingTenantId: tenantId, entityId: args.programId, entityType: 'PROGRAM', actionName: 'PROGRAM.DEFINITION.PUBLISHED', actorId: actor.userId, actorType: 'USER', diff };
    await tx.auditAction.create({ data: { ...event, hash: createHash('sha256').update(JSON.stringify(event)).digest('hex') } });
    return published;
  });
}

export async function assertSandboxPublicationTenant(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { kind: true, status: true, parentOrganizationId: true } });
  if (!tenant || tenant.kind !== 'SYNTHETIC' || tenant.status !== 'ACTIVE' || !tenant.parentOrganizationId) throw new InsuranceConfigurationError('Config MCP publication is restricted to an active synthetic tenant belonging to a sandbox organization.');
}
