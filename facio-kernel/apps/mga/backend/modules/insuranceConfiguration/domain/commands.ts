import { z } from 'zod';
import { processConfigurationSchema } from './processConfiguration.js';
import { symphonyProductSchema } from './productConfiguration.js';

export const readInsuranceConfigurationSchema = z.object({ programId: z.string().uuid() }).strict();
export const saveInsuranceConfigurationSchema = readInsuranceConfigurationSchema.extend({
  baseDefinitionId: z.string().uuid(), expectedDefinitionHash: z.string().regex(/^[a-f0-9]{64}$/),
  process: processConfigurationSchema, product: symphonyProductSchema,
}).strict();
export const insuranceConfigurationResultSchema = z.object({
  programId: z.string().uuid(), definitionId: z.string().uuid(), version: z.number().int().positive(),
  definitionHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.string(),
  process: processConfigurationSchema.nullable(), product: symphonyProductSchema.nullable(),
  publicationIssues: z.array(z.string()),
  runtimeSupport: z.array(z.object({ capability: z.string(), status: z.enum(['supported', 'requires_adapter', 'configuration_only']), detail: z.string() }).strict()),
}).strict();
export const insuranceConfigurationSchemaResultSchema = z.object({ schemaVersion: z.literal(1), schemaJson: z.string(), sourceRevision: z.string(), sourceFiles: z.array(z.string()) }).strict();
export type SaveInsuranceConfigurationInput = z.infer<typeof saveInsuranceConfigurationSchema>;
export type InsuranceConfigurationResult = z.infer<typeof insuranceConfigurationResultSchema>;

export const publishInsuranceConfigurationSchema = readInsuranceConfigurationSchema.extend({ definitionId: z.string().uuid(), expectedDefinitionHash: z.string().regex(/^[a-f0-9]{64}$/), binderProductAuthorityIds: z.array(z.string().uuid()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length, 'Select distinct binder authorities') }).strict();
