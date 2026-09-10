import { composeEngineQuestionnaire } from './questionnaireComposition.js';
import { sourceConfigurationAdapter } from './sourceAdapters.js';
import { z } from 'zod';
import type { JsonObject } from '../../../platform/types/json.js';
import { effectiveCustomerCapability, processConfigurationSchema } from './processConfiguration.js';
import { symphonyProductSchema, type SymphonyProductConfiguration } from './productConfiguration.js';
import { binderScopesSchema, compileQuestionScope, inheritQuestionGroupScopes, type BinderScope, type ScopeCompilation } from './questionScopes.js';
import { ambiguousQuestionAnswerKeys } from './questionIdentities.js';

export const insuranceConfigurationSchema = z.object({ schemaVersion: z.literal(1), process: processConfigurationSchema, product: symphonyProductSchema }).strict();
export type InsuranceConfiguration = z.infer<typeof insuranceConfigurationSchema>;
export class InsuranceConfigurationError extends Error {
  readonly code = 'INSURANCE_CONFIGURATION_INVALID';
}
export function readInsuranceConfiguration(workflow: JsonObject): InsuranceConfiguration | null {
  if (workflow.insuranceConfiguration === undefined) return null;
  return insuranceConfigurationSchema.parse(workflow.insuranceConfiguration);
}

export const ANSWER_TYPE_MAPPING: Record<string, string> = {
  'Short Text': 'text', 'Long Text': 'textarea', Number: 'number', 'Currency ($)': 'currency', Date: 'date',
  Dropdown: 'select', 'Radio (single choice)': 'select', 'Multi-select': 'multiselect', 'Dropdown (Yes/No)': 'boolean', Boolean: 'boolean', Instruction: 'textarea',
};

export function parseQuestionCondition(raw: string) {
  const match = raw.trim().match(/^([a-zA-Z][a-zA-Z0-9_.-]*)(>=|<=|!=|=|<|>|\*)(.*)$/);
  if (!match || (match[2] === '*' && match[3].trim())) throw new InsuranceConfigurationError(`Unsupported OPEN IF predicate: ${raw}`);
  return { key: match[1], operator: match[2], value: match[3].trim() };
}

/** Flatten ancestor predicates so hidden controlling answers cannot activate descendants. */
function questionVisibilityRules(product: SymphonyProductConfiguration, key: string): JsonObject[] {
  const questions = new Map(product.details.proposalQuestionGroups.flatMap((group) => group.questions).map((question) => [question.slug, question]));
  const rules: JsonObject[] = [], visited = new Set<string>(); let next: string | undefined = key;
  while (next && questions.get(next)?.openIf) {
    if (visited.has(next)) throw new InsuranceConfigurationError('Conditional visibility cycle.');
    visited.add(next); const condition = parseQuestionCondition(questions.get(next)!.openIf!);
    rules.push({ field: condition.key, sourceComparison: { operator: condition.operator, value: condition.value } }); next = condition.key;
  }
  return rules;
}

/** A hidden controlling answer cannot reveal a descendant through a stale retained answer. */
function compiledScopeWithAncestors(product: SymphonyProductConfiguration, question: SymphonyProductConfiguration['details']['proposalQuestionGroups'][number]['questions'][number], context: ScopeCompilation) {
  const questions = new Map(product.details.proposalQuestionGroups.flatMap((group) => group.questions).map((row) => [row.slug, row]));
  const dependencies = questionVisibilityRules(product, question.slug).map((rule) => questions.get(String(rule.field))).filter((row): row is typeof question => Boolean(row));
  const scopes = [question, ...dependencies].map((row) => compileQuestionScope(product, row, context)).filter((scope) => scope !== undefined);
  if (!scopes.length) return undefined;
  let authorityIds: string[] | undefined;
  for (const scope of scopes) if (scope.authorityIds) authorityIds = authorityIds ? authorityIds.filter((id) => scope.authorityIds!.includes(id)) : scope.authorityIds;
  if (authorityIds && !authorityIds.length) throw new InsuranceConfigurationError(`Question ${question.slug}: controlling questions have incompatible binder scopes.`);
  return { version: 1, selectors: scopes.flatMap((scope) => scope.selectors), ...(authorityIds ? { authorityIds } : {}) };
}

/** The source product owns these questions; generated sections are checked, never edited separately. */
export function compileProposalQuestionnaire(product: SymphonyProductConfiguration, allowUnsupportedDraft = false, engine?: { productType: string; version: number; scopeBindings?: BinderScope[] }): JsonObject {
  const scopes = engine?.scopeBindings ? { productType: engine.productType, binders: binderScopesSchema.parse(engine.scopeBindings) } : undefined;
  if (scopes) product = inheritQuestionGroupScopes(product);
  const requiredness: JsonObject = {};
  const sections = product.details.proposalQuestionGroups.map((group, groupIndex) => ({
    id: `source-group-${groupIndex + 1}`, title: group.name,
    ...(group.introText ? { description: group.introText } : {}),
    questions: group.questions.map((question) => {
      let scopeMetadata: JsonObject = {};
      if (scopes) {
        try { const scope = compiledScopeWithAncestors(product, question, scopes); if (scope) scopeMetadata = { sourceScope: scope }; }
        catch (error) { if (!allowUnsupportedDraft) throw error; scopeMetadata = { sourceScopeError: error instanceof Error ? error.message : 'Invalid question scope.' }; }
      }
      const paragraph = Boolean(scopes && (question.answerType === 'Instruction' || question.settings?.informationalOnly));
      const type = paragraph ? 'paragraph' : ANSWER_TYPE_MAPPING[question.answerType];
      if (!type && !allowUnsupportedDraft) throw new InsuranceConfigurationError(`Question ${question.slug}: ${question.answerType} requires a registered Gen2 renderer/validator before publication.`);
      if (question.required && question.answerType !== 'Instruction' && !question.settings?.informationalOnly) requiredness[question.slug] = ['quote', 'bind'];
      return {
        key: question.slug, label: question.field, type: type || `unsupported:${question.answerType}`,
        ...(paragraph ? { body: question.body ?? question.field } : {}),
        ...(question.options ? { options: question.options } : {}),
        ...(question.openIf ? { visibleWhen: questionVisibilityRules(product, question.slug) } : {}),
        ...(question.required && question.answerType !== 'Instruction' && !question.settings?.informationalOnly ? { requiredAtStages: ['quote', 'bind'] } : {}),
        ...(question.settings?.helpText ? { help: question.settings.helpText } : {}),
        ...(question.settings?.placeholder ? { placeholder: question.settings.placeholder } : {}),
        sourceQuestionId: question.id,
        ...scopeMetadata,
      };
    }),
  }));
  const source: JsonObject = { sourceCompilerVersion: 2, requiredness, sections };
  if (!engine) return source;
  try {
    const composed = composeEngineQuestionnaire(source, engine.productType, engine.version);
    return scopes ? { ...composed, sourceCompilerVersion: 4, sourceScopeProductType: engine.productType, sourceScopeBindings: scopes.binders } : composed;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Engine questionnaire composition failed.';
    if (!allowUnsupportedDraft) throw new InsuranceConfigurationError(message);
    // Drafts are workspaces, not releases. Retain structurally valid source
    // questions even while their engine dependencies are incomplete, and keep
    // the exact readiness error beside the generated source. Publication still
    // calls the strict compiler/validator and therefore fails closed.
    return {
      ...source,
      sourceCompilerVersion: scopes ? 4 : 3,
      sourceScopeProductType: engine.productType,
      ...(scopes ? { sourceScopeBindings: scopes.binders } : {}),
      sourceCompositionError: message,
    };
  }
}

export function compileProcessChannels(configuration: InsuranceConfiguration): JsonObject {
  return { questions: effectiveCustomerCapability(configuration.process, 'forms'), quote: effectiveCustomerCapability(configuration.process, 'approve'), payment: effectiveCustomerCapability(configuration.process, 'pay') };
}

export function configurationPublicationIssues(configuration: InsuranceConfiguration, productType?: string, scopes?: ScopeCompilation): string[] {
  const issues: string[] = [];
  const product = scopes ? inheritQuestionGroupScopes(configuration.product) : configuration.product;
  const sourceAdapter = sourceConfigurationAdapter(productType);
  const questions = product.details.proposalQuestionGroups.flatMap((group) => group.questions);
  for (const key of ambiguousQuestionAnswerKeys(questions)) issues.push(`Question answer key ${key} is ambiguous: an ID or slug cannot belong to more than one question.`);
  const keys = new Set(questions.map((question) => question.slug));
  const dependencies = new Map<string, string>();
  for (const question of questions) {
    if (!ANSWER_TYPE_MAPPING[question.answerType]) issues.push(`Question ${question.slug}: ${question.answerType} has no registered Gen2 renderer/validator.`);
    if (question.openIf) {
      try {
        const condition = parseQuestionCondition(question.openIf);
        if (!keys.has(condition.key)) issues.push(`Question ${question.slug}: OPEN IF references missing question ${condition.key}.`);
        dependencies.set(question.slug, condition.key);
      } catch (error) { issues.push(error instanceof Error ? error.message : 'Invalid OPEN IF'); }
    }
    if (scopes) {
      try { compiledScopeWithAncestors(product, question, scopes); } catch (error) { issues.push(error instanceof Error ? error.message : 'Invalid question scope.'); }
    } else {
      if (question.coverage && question.coverage !== 'All') issues.push(`Question ${question.slug}: scoped coverage filtering requires source compiler 4 with a registered coverage mapping.`);
      if (question.segment && question.segment !== 'All') issues.push(`Question ${question.slug}: segment filtering requires source compiler 4 with a registered segment-to-risk mapping.`);
      for (const field of ['binder', 'section'] as const) if (question[field] && question[field] !== 'All') issues.push(`Question ${question.slug}: ${field} scope requires source compiler 4.`);
    }
    if (question.settings?.documentRequired || question.settings?.policyComponent || question.settings?.outputType || question.settings?.defaultValue) issues.push(`Question ${question.slug}: document, policy component, output conversion or default-answer behavior requires a registered adapter.`);
  }
  for (const key of keys) {
    const visited = new Set<string>(); let next: string | undefined = key;
    while (next) { if (visited.has(next)) { issues.push(`Question ${key}: conditional visibility cycle.`); break; } visited.add(next); next = dependencies.get(next); }
  }
  if (sourceAdapter) return [...new Set([...issues, ...sourceAdapter.validate(product)])];
  const executablePricingKeys = ['calculationsByCoverage', 'productLines', 'basePremiumMatrix', 'ilfSumMatrix', 'ilfExcessMatrix', 'bundleMinimum', 'selectedPremiumRule', 'defaultGlobalAggregate', 'defaultExcess', 'enforceMinimumPremium', 'selectedPremiumLogic', 'finalTPPremium'];
  for (const key of executablePricingKeys) {
    const value = (product.details as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && (typeof value !== 'object' || Object.keys(value).length > 0)) issues.push(`Product details.${key}: Symphony pricing requires a registered commercial rating adapter. Existing Gen2 published rating tables remain authoritative.`);
  }
  if (product.details.professions?.some((profession) => profession.segmentCalculation || Object.keys(profession.riskCodesByCoverage).length)) issues.push('Profession risk codes/calculations require an explicit registered rating mapping.');
  if (product.coverageSections.length) issues.push('Source coverage sections require explicit mapping to the registered Gen2 coverage catalogue before publication; existing programme coverage remains authoritative.');
  if (product.details.wordingClauses && Object.values(product.details.wordingClauses).some((clauses) => clauses.length)) issues.push('Source wording clauses require registered document mappings before publication.');
  return [...new Set(issues)];
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function validateInsuranceConfigurationComponents(components: { workflow: JsonObject; questionnaire: JsonObject; channels: JsonObject }, productType?: string): void {
  const configuration = readInsuranceConfiguration(components.workflow);
  if (!configuration) return;
  const version = components.questionnaire.sourceCompilerVersion;
  const scopeBindings = version === 4 ? binderScopesSchema.parse(components.questionnaire.sourceScopeBindings) : undefined;
  if (version === 4 && components.questionnaire.sourceScopeProductType !== productType) throw new InsuranceConfigurationError('Question scopes must use the selected programme product.');
  const scopes = scopeBindings && productType ? { productType, binders: scopeBindings } : undefined;
  const issues = configurationPublicationIssues(configuration, productType, scopes);
  if (issues.length) throw new InsuranceConfigurationError(issues.join(' '));
  if ((version === 3 || version === 4) && (components.questionnaire.engineContractVersion !== 1 || !productType)) throw new InsuranceConfigurationError('Source compiler 3/4 requires an explicit registered product and engine questionnaire version 1.');
  const expectedQuestionnaire = compileProposalQuestionnaire(configuration.product, false, version === 3 || version === 4 ? { productType: productType!, version: 1, ...(scopeBindings ? { scopeBindings } : {}) } : undefined);
  if (components.questionnaire.sourceCompilerVersion === undefined) {
    // Preserve already-saved first compiler output; a new draft upgrades rendering metadata.
    const sourceQuestions = configuration.product.details.proposalQuestionGroups.flatMap((group) => group.questions);
    expectedQuestionnaire.sections = (expectedQuestionnaire.sections as JsonObject[]).map((section) => ({ ...section, questions: (section.questions as JsonObject[]).map((question) => {
      const { visibleWhen: _visibleWhen, requiredAtStages: _requiredAtStages, ...previous } = question;
      const source = sourceQuestions.find((entry) => entry.slug === question.key);
      return { ...previous, ...(source?.openIf ? { dependsOn: parseQuestionCondition(source.openIf) } : {}) };
    }) }));
  } else if (version !== 2 && version !== 3 && version !== 4) throw new InsuranceConfigurationError('Unsupported source questionnaire compiler version.');
  for (const key of ['sections', 'requiredness']) if (stable(components.questionnaire[key]) !== stable(expectedQuestionnaire[key])) throw new InsuranceConfigurationError(`Questionnaire ${key} must be generated from the canonical source product, not edited independently.`);
  const expectedChannels = compileProcessChannels(configuration);
  for (const key of ['questions', 'quote', 'payment']) if (components.channels[key] !== expectedChannels[key]) throw new InsuranceConfigurationError(`Channel ${key} conflicts with the configured customer capability.`);
}

export type JourneyActor = 'customer' | 'agent' | 'operator';
export type JourneyAction = 'questions' | 'quote' | 'approve' | 'documents' | 'portal' | 'payment' | 'claim' | 'cancel' | 'bind' | 'uploadCustomerData' | 'viewExpectedCommission';
export function assertConfiguredJourneyCapability(workflow: JsonObject, actor: JourneyActor, action: JourneyAction): void {
  const configuration = readInsuranceConfiguration(workflow);
  if (!configuration) return;
  if (!configuration.product.active || configuration.product.status !== 'Active') throw new InsuranceConfigurationError('The configured product is not active.');
  if (actor === 'operator') return; // Existing server permissions and insurance authority gates still apply.
  let allowed = false;
  if (actor === 'customer') {
    const mapping = { questions: 'forms', quote: 'approve', approve: 'approve', documents: 'docs', portal: 'portal', payment: 'pay', claim: 'claim', cancel: 'cancel' } as const;
    if (action in mapping) allowed = effectiveCustomerCapability(configuration.process, mapping[action as keyof typeof mapping]);
  } else {
    const mapping = { questions: 'uploadCustomerData', quote: 'submitProposals', uploadCustomerData: 'uploadCustomerData', viewExpectedCommission: 'viewExpectedCommission', claim: 'reportClaims', cancel: 'requestCancellation' } as const;
    if (action in mapping) allowed = configuration.process.agents.enabled && configuration.process.agents.permissions.includes(mapping[action as keyof typeof mapping]);
  }
  if (!allowed) throw new InsuranceConfigurationError(`Configured ${actor} capability does not allow ${action}. Actor permissions cannot be granted by client input.`);
}
