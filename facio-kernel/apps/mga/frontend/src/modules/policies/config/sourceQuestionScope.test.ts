import { describe, expect, it, vi } from 'vitest';
import { isSourceQuestionScopeVisible } from './sourceQuestionScope';
import { resolveProgramQuestionnaire } from './questionnaires';
import { isQuestionVisibleForUnderwriting } from '../underwriting/model/questionnaireProjection';
import { computeLiveQuestionnaireMetrics } from '../underwriting/model/liveQuestionnaireMetrics';

const authority = '11111111-1111-4111-8111-111111111111';
const scope = { version: 1, authorityIds: [authority], selectors: [
  { field: 'risk.coverages', itemKey: 'coverage', values: ['Liability', 'Property'] },
  { field: 'risk.segment', values: ['Training'] },
  { field: 'risk.coverages', itemKey: 'coverage', values: ['Liability'] },
] };
const answers = { risk: { coverages: [{ coverage: ' LIABility ' }], segment: 'training' } };

describe('published question scope projection', () => {
  it('ANDs coverage, segment, section and trusted authority while ORing selected allowed values', () => {
    expect(isSourceQuestionScopeVisible(scope, answers, authority)).toBe(true);
    expect(isSourceQuestionScopeVisible(scope, { risk: { coverages: [{ coverage: 'Property' }], segment: 'training' } }, authority)).toBe(false);
    expect(isSourceQuestionScopeVisible(scope, { ...answers, 'risk.segment': 'other' }, authority)).toBe(false);
    expect(isSourceQuestionScopeVisible(scope, { ...answers, binderProductAuthorityId: authority })).toBe(false);
    expect(isSourceQuestionScopeVisible(scope, answers, '22222222-2222-4222-8222-222222222222')).toBe(false);
  });
  it.each([undefined, null, '', []])('keeps missing selection %j visible while authority stays mandatory', (value) => {
    expect(isSourceQuestionScopeVisible(scope, { 'risk.coverages': value, 'risk.segment': value }, authority)).toBe(true);
    expect(isSourceQuestionScopeVisible(scope, { 'risk.coverages': value, 'risk.segment': value })).toBe(false);
  });
  it.each([null, {}, { version: 2, selectors: [] }, { version: 1, selectors: [{ field: 'x', values: [] }] },
    { version: 1, selectors: [], authorityIds: [] }, { version: 1, selectors: [], unknown: true },
    { version: 1, selectors: [{ field: '__proto__.scope', values: ['x'] }] }])('fails closed on malformed scope %j', (value) => {
    expect(isSourceQuestionScopeVisible(value, answers, authority)).toBe(false);
  });
  it('retains malformed scope and compiler errors through normalization instead of dropping their restrictions', () => {
    const [part] = resolveProgramQuestionnaire({ id: 'published', questionnaire: { sections: [{ title: 'Scope', questions: [
      { key: 'custom', label: 'Custom', sourceScope: { version: 99 }, sourceScopeError: 'Unresolved reference' },
    ] }] } });
    const [question] = part.questions;
    expect(question.sourceScope).toEqual({ version: 99 });
    expect(question.sourceScopeError).toBe('Unresolved reference');
    expect(isQuestionVisibleForUnderwriting({ fieldKey: 'custom', contractMeta: undefined,
      visibleWhenOverride: undefined, sourceScope: question.sourceScope, sourceScopeError: question.sourceScopeError,
      context: { actor: 'underwriter', stage: 'quote' }, quoteData: answers, dirtyFields: {}, binderProductAuthorityId: authority })).toBe(false);
  });
  it('composes OPEN IF with scope and evaluates current unsaved controlling answers', () => {
    const args = { fieldKey: 'custom', contractMeta: undefined, sourceScope: scope,
      visibleWhenOverride: { field: 'open', sourceComparison: { operator: '=', value: 'yes' } },
      context: { actor: 'underwriter' as const, stage: 'quote' as const }, quoteData: { ...answers, open: true },
      dirtyFields: {}, binderProductAuthorityId: authority };
    expect(isQuestionVisibleForUnderwriting(args)).toBe(true);
    expect(isQuestionVisibleForUnderwriting({ ...args, dirtyFields: { open: false } })).toBe(false);
    expect(isQuestionVisibleForUnderwriting({ ...args, dirtyFields: { 'risk.segment': 'other' } })).toBe(false);
  });
  it('never treats authored paragraphs as an answer or a risk flag even with stale field metadata', () => {
    const getQuestionValue = vi.fn();
    expect(computeLiveQuestionnaireMetrics({
      questionnaireStructure: [{ questions: [{ key: 'instruction', type: 'paragraph', requiredAtStages: ['quote'] }] }],
      questionContractByKey: { instruction: { requiredAtStages: ['quote'] } },
      quoteData: { instruction: 'Stale answer' }, dirtyFields: {}, productType: 'COMMERCIAL', underwritingStage: 'quote',
      underwritingTriggers: [{ fields: ['instruction'] }], getQuestionValue, hasReplacementData: () => false,
    })).toEqual({ total: 0, completed: 0, riskFlags: 0 });
    expect(getQuestionValue).not.toHaveBeenCalled();
  });
  it('counts required custom questions only in their visible published scope and preserves hidden answers', () => {
    const saved = { ...answers, custom: 'retained answer' };
    const args = { questionnaireStructure: [{ questions: [{ key: 'custom', sourceScope: scope, requiredAtStages: ['quote' as const] }] }],
      questionContractByKey: {}, quoteData: saved, dirtyFields: {}, productType: 'COMMERCIAL',
      underwritingStage: 'quote' as const, underwritingTriggers: [{ fields: ['custom'] }],
      getQuestionValue: () => saved.custom, hasReplacementData: () => false, binderProductAuthorityId: authority };
    expect(computeLiveQuestionnaireMetrics(args)).toEqual({ total: 1, completed: 1, riskFlags: 1 });
    expect(computeLiveQuestionnaireMetrics({ ...args, dirtyFields: { 'risk.segment': 'other' } })).toEqual({ total: 0, completed: 0, riskFlags: 0 });
    expect(saved.custom).toBe('retained answer');
    expect(computeLiveQuestionnaireMetrics({ ...args, getQuestionValue: () => '' })).toEqual({ total: 1, completed: 0, riskFlags: 1 });
  });
});
