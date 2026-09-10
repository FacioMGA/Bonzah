import type { JsonObject, JsonValue } from '@/src/modules/programs/components/StructuredJsonEditor';

/** UI field descriptors are delivered from the backend's canonical Zod schema. */
export interface EditorSchema {
  type?: string | string[];
  properties?: Record<string, EditorSchema>;
  required?: string[];
  items?: EditorSchema;
  additionalProperties?: EditorSchema | boolean;
  anyOf?: EditorSchema[];
  enum?: JsonValue[];
  const?: JsonValue;
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
}
export type ConfigurationView = {
  programId: string; definitionId: string; version: number; definitionHash: string; status: string;
  process: JsonObject | null; product: JsonObject | null; publicationIssues: string[];
  runtimeSupport: Array<{ capability: string; status: 'supported' | 'requires_adapter' | 'configuration_only'; detail: string }>;
};
export type ConfigurationSchemaView = { schemaVersion: 1; schemaJson: string; sourceRevision: string; sourceFiles: string[] };
export function editableSchema(schema: EditorSchema): EditorSchema {
  return schema.anyOf?.find((variant) => variant.type !== 'null') ?? schema;
}
export function initialFieldValue(raw: EditorSchema): JsonValue {
  const schema = editableSchema(raw);
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'object') return Object.fromEntries((schema.required ?? []).map((key) => [key, initialFieldValue(schema.properties?.[key] ?? {})]));
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  // Numeric controls start empty: no rate, limit or authority is invented.
  return '';
}
