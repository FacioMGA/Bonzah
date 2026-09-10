import { McpToolError } from '../../mcp/domain/toolError.js';
import { InsuranceConfigurationError } from '../domain/runtimeConfiguration.js';
import { z } from 'zod';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';
import { insuranceConfigurationEditorSchema, readInsuranceConfiguration, saveInsuranceConfiguration, publishInsuranceConfiguration } from './configurationService.js';
import { readInsuranceConfigurationSchema, saveInsuranceConfigurationSchema, publishInsuranceConfigurationSchema, insuranceConfigurationResultSchema, insuranceConfigurationSchemaResultSchema } from '../domain/commands.js';

export const readInsuranceConfigurationTool: ToolDescriptor<z.infer<typeof readInsuranceConfigurationSchema>, z.infer<typeof insuranceConfigurationResultSchema>> = {
  name: 'config.insurance.read', family: 'config', requiredPermission: 'configuration.read', auditClass: 'read',
  inputSchema: readInsuranceConfigurationSchema, outputSchema: insuranceConfigurationResultSchema,
  description: 'Read the selected tenant programme insurance/workflow configuration and exact definition hash. Does not inspect another tenant or apply drafts.',
  run: readInsuranceConfiguration,
};
export const saveInsuranceConfigurationTool: ToolDescriptor<z.infer<typeof saveInsuranceConfigurationSchema>, z.infer<typeof insuranceConfigurationResultSchema>> = {
  name: 'config.insurance.save', family: 'config', requiredPermission: 'configuration.draft', auditClass: 'draft',
  inputSchema: saveInsuranceConfigurationSchema, outputSchema: insuranceConfigurationResultSchema,
  description: 'Append a programme definition draft using the exact current hash. Compile supported source questionnaire/channel configuration. Publication and binder authority mapping are separate.',
  run: async (input, context) => { try { return await saveInsuranceConfiguration(input, context); } catch (error) { if (error instanceof InsuranceConfigurationError) throw new McpToolError({ code: 'VALIDATION_ERROR', message: error.message }); throw error; } },
};
const emptySchema = z.object({}).strict();
export const insuranceConfigurationSchemaTool: ToolDescriptor<z.infer<typeof emptySchema>, z.infer<typeof insuranceConfigurationSchemaResultSchema>> = {
  name: 'config.insurance.schema', family: 'config', requiredPermission: 'configuration.read', auditClass: 'read',
  inputSchema: emptySchema, outputSchema: insuranceConfigurationSchemaResultSchema,
  description: 'Return the same source-derived typed editor contract used by the back office and save command.',
  run: async (_input, context) => insuranceConfigurationEditorSchema(context),
};

export const publishInsuranceConfigurationTool: ToolDescriptor<z.infer<typeof publishInsuranceConfigurationSchema>, z.infer<typeof insuranceConfigurationResultSchema>> = {
 name: 'config.insurance.publish', family: 'config', requiredPermission: 'configuration.publish_sandbox', auditClass: 'publish', inputSchema: publishInsuranceConfigurationSchema, outputSchema: insuranceConfigurationResultSchema, description: 'Publish the exact reviewed programme definition to explicit active binder authorities in the selected synthetic sandbox tenant. Runtime consumes that published definition; changes, mappings and audit are atomic.', run: async (input, context) => { try { return await publishInsuranceConfiguration(input, context); } catch (error) { if (error instanceof InsuranceConfigurationError) throw new McpToolError({ code: 'PUBLISH_BLOCKED', message: error.message }); throw error; } },
};
