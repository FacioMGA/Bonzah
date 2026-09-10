import { publishProgrammeDefinition, assertSandboxPublicationTenant } from './publishProgrammeDefinition.js';
import { publishInsuranceConfigurationSchema } from '../domain/commands.js';
import { z } from 'zod';
import { sourceConfigurationAdapter } from '../domain/sourceAdapters.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import type { JsonObject } from '../../../platform/types/json.js';
import { McpToolError } from '../../mcp/domain/toolError.js';
import { insuranceConfigurationSchema, configurationPublicationIssues, readInsuranceConfiguration as readAttachedConfiguration } from '../domain/runtimeConfiguration.js';
import { readInsuranceConfigurationSchema, saveInsuranceConfigurationSchema, insuranceConfigurationResultSchema, type InsuranceConfigurationResult } from '../domain/commands.js';
import { appendConfiguredDraft, definitionHash, readLatestDefinition, type ConfigurationDefinition } from '../infra/programmeRepository.js';
import { binderScopesSchema } from '../domain/questionScopes.js';

export type ConfigurationActor = { tenantId: string; userId: string; permissions: string[] };
function authorize(context: ConfigurationActor, permission: string): string {
  const tenantId = getTenantConfig().id;
  if (tenantId !== context.tenantId || !context.userId || !context.permissions.includes(permission)) throw new McpToolError({ code: 'UNAUTHORIZED', message: 'This operation requires an authorized actor in the selected operating tenant.' });
  return tenantId;
}
const runtimeSupport = [
  { capability: 'customer_and_agent_capabilities', status: 'supported' as const, detail: 'Published programme channels and journey permission guards; configuration only restricts authenticated authority.' },
  { capability: 'proposal_questions', status: 'supported' as const, detail: 'Explicit question wording, basic answer types, choices, bounds, OPEN IF and requiredness are compiled and server validated.' },
  { capability: 'commercial_pricing_and_coverage', status: 'requires_adapter' as const, detail: 'Full source contracts are retained for inspection. Imported pricing, coverage sections and clauses block publication until mapped to registered Gen2 engines; existing rating/coverage editors remain authoritative.' },
  { capability: 'agent_commercial_terms', status: 'configuration_only' as const, detail: 'Contract types, bonus, commission and cancellation preferences do not compute commissions, refunds or establish a legal agreement.' },
];
export function insuranceConfigurationResult(definition: ConfigurationDefinition): InsuranceConfigurationResult {
  const configuration = readAttachedConfiguration(definition.workflow as JsonObject);
  const questionnaire = definition.questionnaire as JsonObject;
  const scopes = questionnaire.sourceCompilerVersion === 4 && definition.program?.productType ? { productType: definition.program.productType, binders: binderScopesSchema.parse(questionnaire.sourceScopeBindings) } : undefined;
  return insuranceConfigurationResultSchema.parse({ programId: definition.programId, definitionId: definition.id, version: definition.version, definitionHash: definitionHash(definition), status: definition.status, process: configuration?.process ?? null, product: configuration?.product ?? null, publicationIssues: configuration ? configurationPublicationIssues(configuration, definition.program?.productType ?? undefined, scopes) : [], runtimeSupport: runtimeSupport.map((row) => row.capability === 'commercial_pricing_and_coverage' && sourceConfigurationAdapter(definition.program?.productType ?? undefined) ? { ...row, status: 'supported', detail: 'Published source coverage tables, source calculations and schedule wording execute through the registered product engine. Publication checks list unsupported configurations explicitly.' } : row) });
}
export async function readInsuranceConfiguration(input: unknown, context: ConfigurationActor): Promise<InsuranceConfigurationResult> {
  const tenantId = authorize(context, 'configuration.read');
  const args = readInsuranceConfigurationSchema.parse(input);
  const definition = await readLatestDefinition(tenantId, args.programId);
  if (!definition) throw new McpToolError({ code: 'DRAFT_NOT_FOUND', message: 'No programme definition is available in this operating tenant.' });
  return insuranceConfigurationResult(definition);
}
export async function saveInsuranceConfiguration(input: unknown, context: ConfigurationActor): Promise<InsuranceConfigurationResult> {
  const operatingTenantId = authorize(context, 'configuration.draft');
  const args = saveInsuranceConfigurationSchema.parse(input);
  const definition = await appendConfiguredDraft({ ...args, operatingTenantId, actorId: context.userId, configuration: { schemaVersion: 1, process: args.process, product: args.product } });
  return insuranceConfigurationResult(definition);
}
export function insuranceConfigurationEditorSchema(context: ConfigurationActor) {
  authorize(context, 'configuration.read');
  return { schemaVersion: 1 as const, schemaJson: JSON.stringify(z.toJSONSchema(insuranceConfigurationSchema)), sourceRevision: '74499802ee76869c923c2227a18883d06eeb7b4b', sourceFiles: ['symphony-api/src/routes/processConfig.ts', 'symphony-api/src/services/customerCapabilities.ts', 'facio-admin/src/api/client.ts (committed source contract)', 'symphony-api/src/services/questionSettings.ts', 'symphony-api/src/services/questionSync.ts', 'symphony-api/src/services/segmentSync.ts'] };
}

export async function publishInsuranceConfiguration(input: unknown, context: ConfigurationActor): Promise<InsuranceConfigurationResult> {
  const tenantId = authorize(context, 'configuration.publish_sandbox');
  const args = publishInsuranceConfigurationSchema.parse(input);
  await assertSandboxPublicationTenant(tenantId);
  return insuranceConfigurationResult(await publishProgrammeDefinition(args, context));
}
