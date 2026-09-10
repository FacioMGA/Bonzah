import type { JsonObject } from '../../../platform/types/json.js';
import { engineQuestionnaireContract } from './sourceAdapters.js';
const rows = (value: unknown): JsonObject[] => Array.isArray(value) ? value as JsonObject[] : [];
/** Materialize engine inputs into a new reviewed draft; no manifest fallback occurs while reading a policy. */
export function composeEngineQuestionnaire(source: JsonObject, productType: string, engineContractVersion: number): JsonObject {
  const base = engineQuestionnaireContract(productType, engineContractVersion);
  const sourceSections = rows(source.sections), overrides = new Map(sourceSections.flatMap((section) => rows(section.questions)).map((question) => [String(question.key), question]));
  const requiredness = { ...(base.requiredness as JsonObject), ...(source.requiredness as JsonObject) };
  const sections = rows(base.sections).map((section) => ({ ...section, questions: rows(section.questions).map((question) => {
    const override = overrides.get(String(question.key));
    if (!override) return question;
    overrides.delete(String(question.key));
    const numberTypes = new Set(['number', 'currency']);
    if (question.type !== override.type && !(numberTypes.has(String(question.type)) && numberTypes.has(String(override.type)))) throw new Error(`Question ${question.key}: the authored type conflicts with registered engine type ${question.type}.`);
    if ((override.visibleWhen || override.sourceScope || override.sourceScopeError) && (base.requiredness as JsonObject)[String(question.key)]) throw new Error(`Question ${question.key}: a required engine input cannot be hidden by an additional source condition or scope.`);
    const required = Boolean((base.requiredness as JsonObject)[String(question.key)]);
    return { ...question, ...override, type: question.type, ...(required ? { required: true, requiredAtStages: ['quote', 'bind'] } : {}) };
  }) }));
  for (const section of sourceSections) {
    const questions = rows(section.questions).filter((question) => overrides.has(String(question.key)));
    if (questions.length) sections.push({ ...section, questions });
  }
  return { sourceCompilerVersion: 3, engineContractVersion, requiredness, sections };
}
