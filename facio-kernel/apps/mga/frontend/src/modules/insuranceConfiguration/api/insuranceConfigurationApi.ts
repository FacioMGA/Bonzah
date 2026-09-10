import { http } from '@/src/shared/api/http';
import type { JsonObject } from '@/src/modules/programs/components/StructuredJsonEditor';
import type { ConfigurationSchemaView, ConfigurationView } from '../model/editorContract';

async function data<T>(request: ReturnType<typeof http.request<T>>): Promise<T> {
  const response = await request;
  if (!response.success || response.data === undefined) throw new Error(response.error?.message || 'Configuration request failed.');
  return response.data;
}
export const insuranceConfigurationApi = {
  schema: () => data(http.request<ConfigurationSchemaView>('insurance-configuration/schema')),
  read: (programId: string) => data(http.request<ConfigurationView>(`insurance-configuration/programs/${encodeURIComponent(programId)}`)),
  save: (programId: string, input: { baseDefinitionId: string; expectedDefinitionHash: string; process: JsonObject; product: JsonObject }) => data(http.request<ConfigurationView>(`insurance-configuration/programs/${encodeURIComponent(programId)}`, { method: 'PUT', body: JSON.stringify(input) })),
};
