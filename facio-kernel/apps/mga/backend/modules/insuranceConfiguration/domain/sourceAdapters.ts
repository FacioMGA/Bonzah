import type { SymphonyProductConfiguration } from './productConfiguration.js';

export type SourceConfigurationAdapter = { productType: string; engineId: string; validate: (product: SymphonyProductConfiguration) => string[]; questionScopes?: { coverage?: { field: string; itemKey: string }; segment?: { field: string } }; questionSegments?: (product: SymphonyProductConfiguration) => { id: string; name: string }[] };
const adapters = new Map<string, SourceConfigurationAdapter>();
/** Server bootstrap only. Tenant content cannot register executable code. */
export function registerSourceConfigurationAdapter(adapter: SourceConfigurationAdapter): void {
  const existing = adapters.get(adapter.productType);
  if (existing && existing.engineId !== adapter.engineId) throw new Error(`Conflicting source adapter for ${adapter.productType}.`);
  adapters.set(adapter.productType, adapter);
}
export function sourceConfigurationAdapter(productType: string | undefined): SourceConfigurationAdapter | null { return productType ? adapters.get(productType) ?? null : null; }

import type { ProductManifest } from '@facio/products';
import type { JsonObject } from '../../../platform/types/json.js';
const engineQuestionnaires = new Map<string, JsonObject>();
/** Authoring-only capability version. New meanings require a new version; runtime never fills missing published fields. */
export function registerEngineQuestionnaireContract(manifest: ProductManifest): void {
  const key = `${manifest.productType}:1`;
  const questionnaire = JSON.parse(JSON.stringify({
    requiredness: Object.fromEntries(manifest.questionnaire.sections.flatMap((section) => section.fields).filter((field) => field.required).map((field) => [field.path, ['quote', 'bind']])),
    sections: manifest.questionnaire.sections.map((section) => ({ id: section.id, title: section.title, questions: section.fields.map((field) => ({ ...field, key: field.path, ...(field.required ? { requiredAtStages: ['quote', 'bind'] } : {}) })) })),
  })) as JsonObject;
  const previous = engineQuestionnaires.get(key);
  if (previous && JSON.stringify(previous) !== JSON.stringify(questionnaire)) throw new Error(`Conflicting registered engine questionnaire ${key}.`);
  engineQuestionnaires.set(key, questionnaire);
}
export function engineQuestionnaireContract(productType: string, version: number): JsonObject {
  const questionnaire = engineQuestionnaires.get(`${productType}:${version}`);
  if (!questionnaire) throw new Error(`No registered engine questionnaire ${productType} version ${version}.`);
  return structuredClone(questionnaire);
}
