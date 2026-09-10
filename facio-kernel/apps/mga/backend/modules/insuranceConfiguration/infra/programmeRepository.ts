import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import type { JsonObject } from '../../../platform/types/json.js';
import { InsuranceConfigurationError, compileProcessChannels, compileProposalQuestionnaire, type InsuranceConfiguration } from '../domain/runtimeConfiguration.js';
import { inheritQuestionGroupScopes } from '../domain/questionScopes.js';
import { readProgrammeScopeBindings } from './questionScopeBindings.js';

export type ConfigurationDefinition = {
  program?: { productType: string | null };
  id: string; operatingTenantId: string; programId: string; version: number; status: string; pricingMode: string;
  programRatingModelId: string | null; underwriting: Prisma.JsonValue; coverage: Prisma.JsonValue;
  questionnaire: Prisma.JsonValue; workflow: Prisma.JsonValue; channels: Prisma.JsonValue; documents: Prisma.JsonValue;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, next]) => `${JSON.stringify(key)}:${canonical(next)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function definitionHash(definition: ConfigurationDefinition): string {
  const { id, operatingTenantId, programId, version, pricingMode, programRatingModelId, underwriting, coverage, questionnaire, workflow, channels, documents } = definition;
  return createHash('sha256').update(canonical({ id, operatingTenantId, programId, version, pricingMode, programRatingModelId, underwriting, coverage, questionnaire, workflow, channels, documents })).digest('hex');
}
export async function readLatestDefinition(operatingTenantId: string, programId: string): Promise<ConfigurationDefinition | null> {
  return tenantScopedPrisma.programDefinitionVersion.findFirst({ where: { operatingTenantId, programId, program: { operatingTenantId } }, orderBy: { version: 'desc' }, include: { program: { select: { productType: true } } } });
}
export async function appendConfiguredDraft(args: { operatingTenantId: string; programId: string; baseDefinitionId: string; expectedDefinitionHash: string; configuration: InsuranceConfiguration; actorId: string }): Promise<ConfigurationDefinition> {
  return runTenantScopedTransaction(async (tx) => {
    // Serialize the shared programme version sequence, including retry/CAS reads.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM programs WHERE id = ${args.programId} AND "operatingTenantId" = ${args.operatingTenantId} FOR UPDATE`;
    if (locked.length !== 1) throw new InsuranceConfigurationError('Programme is unavailable in this operating tenant.');
    const current = await tx.programDefinitionVersion.findFirst({ where: { operatingTenantId: args.operatingTenantId, programId: args.programId }, orderBy: { version: 'desc' }, include: { program: { select: { productType: true } } } });
    if (!current || current.id !== args.baseDefinitionId || definitionHash(current) !== args.expectedDefinitionHash) throw new InsuranceConfigurationError('STALE_DEFINITION: reload the latest programme definition before saving.');
    const object = (value: Prisma.JsonValue): JsonObject => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InsuranceConfigurationError('Existing programme component is invalid.');
      return value as JsonObject;
    };
    const configuration = { ...args.configuration, product: inheritQuestionGroupScopes(args.configuration.product) };
    const productType = current.program?.productType;
    const scopeBindings = productType ? await readProgrammeScopeBindings(tx, args.operatingTenantId, args.programId, productType) : undefined;
    const generated = compileProposalQuestionnaire(configuration.product, true, productType ? { productType, version: 1, scopeBindings } : undefined);
    return tx.programDefinitionVersion.create({ data: {
      operatingTenantId: args.operatingTenantId, programId: args.programId, version: current.version + 1, status: 'DRAFT',
      pricingMode: current.pricingMode, programRatingModelId: current.programRatingModelId,
      underwriting: current.underwriting as Prisma.InputJsonValue, coverage: current.coverage as Prisma.InputJsonValue,
      questionnaire: { ...object(current.questionnaire), ...generated } as Prisma.InputJsonValue,
      workflow: { ...object(current.workflow), insuranceConfiguration: configuration } as Prisma.InputJsonValue,
      channels: { ...object(current.channels), ...compileProcessChannels(configuration) } as Prisma.InputJsonValue,
      documents: current.documents as Prisma.InputJsonValue,
      source: 'symphony-insurance-configuration-v1', notes: `Authored by ${args.actorId}; base ${current.id}; base hash ${args.expectedDefinitionHash}. Publish separately to selected binder authorities.`,
    }, include: { program: { select: { productType: true } } } });
  });
}
