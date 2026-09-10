import { describe, expect, it } from 'vitest';
import { CommercialProductAdapter } from '../../../products/commercial/CommercialProductAdapter.js';
import { calculateCommercial } from '../../../products/commercial/pricing.js';
import { syntheticCommercialConfiguration, commercialContext } from '../../../products/commercial/__tests__/fixtures.js';
import { commercialGoldenFixtures } from '../../../products/commercial/goldenFixtures.js';
import { compileProcessChannels, compileProposalQuestionnaire, configurationPublicationIssues, validateInsuranceConfigurationComponents } from '../domain/runtimeConfiguration.js';
import { binderScopesSchema, compileQuestionScope, inheritQuestionGroupScopes, matchesQuestionScope, type BinderScope } from '../domain/questionScopes.js';
import { configuredPricingAnswers, evaluateConfiguredQuestions } from '../domain/questionnaireEvaluation.js';
import { assertRetainedScopeBindings } from '../infra/questionScopeBindings.js';
import { isSourceQuestionScopeVisible } from '../../../../frontend/src/modules/policies/config/sourceQuestionScope';

new CommercialProductAdapter();
const authorityA = '11111111-1111-4111-8111-111111111111', authorityB = '22222222-2222-4222-8222-222222222222';
const binders: BinderScope[] = [{ binderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'TRAINING-A', authorityIds: [authorityA] }, { binderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'TRAINING-B', authorityIds: [authorityB] }];
function fixture() {
  const configuration = syntheticCommercialConfiguration();
  configuration.product.coverageSections[0].sectionLabel = 'Liability';
  configuration.product.details.proposalQuestionGroups.push({ name: 'Scoped review', coverage: 'Training liability', binder: binders[0].binderId, segment: 'training-business', section: 'Liability', questions: [{ id: 'loading', slug: 'loading', field: 'Prior exposure loading?', answerType: 'Boolean', coverage: 'All', required: true }] });
  const questionnaire = compileProposalQuestionnaire(configuration.product, false, { productType: 'COMMERCIAL', version: 1, scopeBindings: binders });
  return { configuration, questionnaire, context: { questionnaire, binderProductAuthorityId: authorityA }, workflow: { insuranceConfiguration: configuration } };
}
const answers = () => structuredClone(commercialGoldenFixtures.minimumValid);

describe('source compiler 4 inherited question scopes', () => {
  it.each(['coverage', 'binder', 'segment', 'section'] as const)('cascades explicit group %s including All, preserves absent group fields, and never mutates source', (field) => {
    const configuration = syntheticCommercialConfiguration();
    const group = configuration.product.details.proposalQuestionGroups[0];
    group.questions[0][field] = 'question-specific';
    expect(inheritQuestionGroupScopes(configuration.product).details.proposalQuestionGroups[0].questions[0][field]).toBe('question-specific');
    group[field] = 'group-specific';
    const original = JSON.stringify(configuration);
    expect(inheritQuestionGroupScopes(configuration.product).details.proposalQuestionGroups[0].questions[0][field]).toBe('group-specific');
    expect(JSON.stringify(configuration)).toBe(original);
    group[field] = 'All';
    expect(inheritQuestionGroupScopes(configuration.product).details.proposalQuestionGroups[0].questions[0][field]).toBe('All');
  });

  it('compiles all four configured scopes, validates the same reviewed metadata and rejects unknown references', () => {
    const { configuration, questionnaire, workflow } = fixture();
    expect(questionnaire.sourceCompilerVersion).toBe(4);
    const custom = (questionnaire.sections as { questions: { key: string; sourceScope?: unknown }[] }[]).flatMap((section) => section.questions).find((question) => question.key === 'loading');
    expect(custom?.sourceScope).toEqual({ version: 1, selectors: [{ field: 'commercial.coverages', itemKey: 'coverage', values: ['Training liability'] }, { field: 'commercial.coverages', itemKey: 'coverage', values: ['Training liability'] }, { field: 'commercial.segmentId', values: ['training-business'] }], authorityIds: [authorityA] });
    const components = { workflow, questionnaire, channels: compileProcessChannels(configuration) };
    expect(() => validateInsuranceConfigurationComponents(components, 'COMMERCIAL')).not.toThrow();
    const forged = structuredClone(questionnaire);
    ((forged.sections as { questions: { key: string; sourceScope?: { authorityIds?: string[] } }[] }[]).flatMap((section) => section.questions).find((question) => question.key === 'loading')!.sourceScope!).authorityIds = [authorityB];
    expect(() => validateInsuranceConfigurationComponents({ ...components, questionnaire: forged }, 'COMMERCIAL')).toThrow(/generated/);
    for (const field of ['coverage', 'binder', 'segment', 'section'] as const) {
      const invalid = structuredClone(configuration); invalid.product.details.proposalQuestionGroups[1][field] = 'missing';
      expect(configurationPublicationIssues(invalid, 'COMMERCIAL', { productType: 'COMMERCIAL', binders }).join(' ')).toContain(field);
    }
  });

  it('enforces requiredness for matching selections, excludes hidden stale answers, and rejects answer-supplied authority', () => {
    const { context, workflow } = fixture();
    expect(evaluateConfiguredQuestions(workflow, answers(), undefined, context)).toContainEqual({ key: 'loading', message: 'Prior exposure loading? is required.' });
    const selected = { ...answers(), loading: true };
    expect(evaluateConfiguredQuestions(workflow, selected, undefined, context)).toEqual([]);
    expect(configuredPricingAnswers(workflow, selected, context).loading).toBe(true);
    for (const change of [{ segmentId: 'different-segment' }, { coverages: [{ coverage: 'Different coverage' }] }]) {
      const hidden = { ...selected, commercial: { ...(selected.commercial as object), ...change } };
      expect(evaluateConfiguredQuestions(workflow, hidden, undefined, context)).toEqual([]);
      expect(configuredPricingAnswers(workflow, hidden, context)).not.toHaveProperty('loading');
    }
    expect(configuredPricingAnswers(workflow, { ...selected, binderProductAuthorityId: authorityA }, { ...context, binderProductAuthorityId: authorityB })).not.toHaveProperty('loading');
    expect(evaluateConfiguredQuestions(workflow, selected, undefined, { ...context, binderProductAuthorityId: '' })[0].key).toBe('sourceScope');
  });

  it('changes the actual registered premium only for the matched retained scope and leaves the other authority unchanged', () => {
    const { configuration, questionnaire } = fixture();
    configuration.product.details.calculationsByCoverage!['Training liability'].loadingsExtensions = [{ id: 'scope-loading', name: 'Configured training loading', factor: '2', appliedAlways: false, questionnaireKey: 'loading', applyTiming: 'after-all-rules' }];
    const context = commercialContext(configuration); context.programDefinition!.questionnaire = questionnaire; context.programDefinition!.binderProductAuthorityId = authorityA;
    const quoted = { ...answers(), loading: true };
    expect(calculateCommercial(quoted, context, 'EUR').premium).toBe(1000);
    const other = structuredClone(context); other.programDefinition!.binderProductAuthorityId = authorityB;
    expect(calculateCommercial(quoted, other, 'EUR').premium).toBe(500);
    expect(calculateCommercial(quoted, context, 'EUR').premium).toBe(1000);
    const changed = structuredClone(configuration); changed.product.details.calculationsByCoverage!['Training liability'].loadingsExtensions![0].factor = '3';
    expect(calculateCommercial(quoted, commercialContext(changed), 'EUR').premium).toBe(1500);
    expect(calculateCommercial(quoted, context, 'EUR').premium).toBe(1000);
  });

  it('preserves compiler 2/3 bytes and meanings, and cannot hide a mandatory engine field', () => {
    const configuration = syntheticCommercialConfiguration();
    const v2 = compileProposalQuestionnaire(configuration.product), v3 = compileProposalQuestionnaire(configuration.product, false, { productType: 'COMMERCIAL', version: 1 });
    const retained = JSON.stringify([v2, v3]);
    const v4 = compileProposalQuestionnaire(configuration.product, false, { productType: 'COMMERCIAL', version: 1, scopeBindings: binders });
    expect(v4.sourceCompilerVersion).toBe(4);
    for (const questionnaire of [v2, v3, v4]) expect(() => validateInsuranceConfigurationComponents({ questionnaire, workflow: { insuranceConfiguration: configuration }, channels: compileProcessChannels(configuration) }, 'COMMERCIAL')).not.toThrow();
    expect(JSON.stringify([v2, v3])).toBe(retained);
    configuration.product.details.proposalQuestionGroups[0].coverage = 'Training liability';
    expect(() => compileProposalQuestionnaire(configuration.product, false, { productType: 'COMMERCIAL', version: 1, scopeBindings: binders })).toThrow(/required engine input/);
  });

  it('propagates parent scopes into conditional descendants and keeps empty source filters visible', () => {
    const { configuration } = fixture();
    configuration.product.details.proposalQuestionGroups.push({ name: 'Follow-up', questions: [{ id: 'details', slug: 'details', field: 'Exposure detail', answerType: 'Short Text', coverage: 'All', required: true, openIf: 'loading=TRUE' }] });
    const questionnaire = compileProposalQuestionnaire(configuration.product, false, { productType: 'COMMERCIAL', version: 1, scopeBindings: binders });
    const rows = (questionnaire.sections as { questions: { key: string; sourceScope?: unknown }[] }[]).flatMap((section) => section.questions);
    expect(rows.find((row) => row.key === 'details')?.sourceScope).toEqual(rows.find((row) => row.key === 'loading')?.sourceScope);
    expect(evaluateConfiguredQuestions({ insuranceConfiguration: configuration }, { ...answers(), loading: true }, undefined, { questionnaire, binderProductAuthorityId: authorityB })).toEqual([]);
    const normalized = inheritQuestionGroupScopes(configuration.product);
    const scope = compileQuestionScope(normalized, normalized.details.proposalQuestionGroups[1].questions[0], { productType: 'COMMERCIAL', binders })!;
    expect(matchesQuestionScope(scope, {}, authorityA)).toBe(true);
    expect(matchesQuestionScope(scope, { commercial: { coverages: 'wrong shape' } }, authorityA)).toBe(false);
    expect(matchesQuestionScope(scope, { commercial: { coverages: [{ coverage: ' training LIABILITY ' }], segmentId: ' TRAINING-BUSINESS ' } }, authorityA)).toBe(true);
  });

  it('rejects foreign/stale binder catalogue authority IDs and ambiguous names while keeping immutable IDs selectable', () => {
    expect(() => assertRetainedScopeBindings(binders, binders)).not.toThrow();
    expect(() => assertRetainedScopeBindings(binders, binders.slice(1))).toThrow(/tenant/);
    expect(() => assertRetainedScopeBindings([{ ...binders[0], authorityIds: [authorityB] }], binders)).toThrow(/tenant/);
    const { configuration } = fixture();
    const product = inheritQuestionGroupScopes(configuration.product), question = product.details.proposalQuestionGroups[1].questions[0];
    const duplicateNames = binders.map((row) => ({ ...row, name: 'SAME' }));
    expect(() => compileQuestionScope(product, { ...question, binder: 'SAME' }, { productType: 'COMMERCIAL', binders: duplicateNames })).toThrow(/immutable ID/);
    expect(compileQuestionScope(product, question, { productType: 'COMMERCIAL', binders: duplicateNames })?.authorityIds).toEqual([authorityA]);
    expect(binderScopesSchema.safeParse([{ ...binders[0], authorityIds: [] }]).success).toBe(false);
  });

  it('matches the shared UI projection for selected, empty, malformed and foreign-authority inputs', () => {
    const { configuration } = fixture();
    const product = inheritQuestionGroupScopes(configuration.product);
    const scope = compileQuestionScope(product, product.details.proposalQuestionGroups[1].questions[0], { productType: 'COMMERCIAL', binders })!;
    const selections = [undefined, null, '', [], {}, 'Training liability', [{ coverage: 'Training liability' }], [{ coverage: ' training LIABILITY ' }], [{ coverage: 'Other' }], [{ coverage: 1 }]];
    const segments = [undefined, null, '', 'training-business', ' TRAINING-BUSINESS ', 'Other', {}, false];
    for (const coverages of selections) for (const segmentId of segments) for (const authority of [authorityA, authorityB, '']) {
      const data = { commercial: { coverages, segmentId } };
      expect(isSourceQuestionScopeVisible(scope, data, authority)).toBe(matchesQuestionScope(scope, data, authority));
    }
  });
});
