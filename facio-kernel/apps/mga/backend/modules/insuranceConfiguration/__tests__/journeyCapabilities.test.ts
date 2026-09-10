import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../platform/db/connection.js', () => ({ tenantScopedPrisma: {} }));
import { projectJourneyCapabilities } from '../app/journeyCapabilities.js';
import { commercialContext, syntheticCommercialConfiguration } from '../../../products/commercial/__tests__/fixtures.js';
import type { ResolvedProgramDefinition } from '../../programs/domain/programDefinition.js';
import { evaluateConfiguredQuestions } from '../domain/questionnaireEvaluation.js';
import { compileProposalQuestionnaire } from '../domain/runtimeConfiguration.js';
import { resolveProgramQuestionnaire } from '../../../../frontend/src/modules/policies/config/questionnaires';
import { isQuestionVisibleForUnderwriting } from '../../../../frontend/src/modules/policies/underwriting/model/questionnaireProjection';
describe('published journey and conditional rendering contract', () => {
  it('exposes effective customer payment separately from actor privileges, and turns inactive products off', () => {
    const source = syntheticCommercialConfiguration(); source.process.customers.pay = true; source.process.customers.portal = false;
    let definition = commercialContext(source).programDefinition! as ResolvedProgramDefinition;
    expect(projectJourneyCapabilities(definition).customer.payment).toBe(false);
    source.process.customers.portal = true; definition = commercialContext(source).programDefinition! as ResolvedProgramDefinition;
    expect(projectJourneyCapabilities(definition).customer.payment).toBe(true);
    source.product.active = false; definition = commercialContext(source).programDefinition! as ResolvedProgramDefinition;
    expect(Object.values(projectJourneyCapabilities(definition).customer).every((value) => !value)).toBe(true);
  });
  it('projects conditions and requiredness into the actual BO renderer including hidden-ancestor and numeric semantics', () => {
    const source = syntheticCommercialConfiguration(); source.product.details.proposalQuestionGroups[0].questions.push(
      { id: 'enabled', slug: 'enabled', field: 'Enabled', answerType: 'Boolean', coverage: 'All', required: true },
      { id: 'count', slug: 'count', field: 'Count', answerType: 'Number', coverage: 'All', required: true, openIf: 'enabled=TRUE' },
      { id: 'detail', slug: 'detail', field: 'Detail', answerType: 'Long Text', coverage: 'All', required: true, openIf: 'count>=10' },
    );
    const questionnaire = compileProposalQuestionnaire(source.product);
    const detail = resolveProgramQuestionnaire({ id: 'definition', questionnaire })[0].questions.find((question) => question.key === 'detail')!;
    expect(detail.requiredAtStages).toEqual(['quote', 'bind']);
    const visible = (data: Record<string, unknown>) => isQuestionVisibleForUnderwriting({ fieldKey: 'detail', contractMeta: {}, visibleWhenOverride: detail.visibleWhen, context: { actor: 'underwriter', stage: 'quote' }, quoteData: data, dirtyFields: {} });
    expect(visible({ enabled: false, count: 20 })).toBe(false); expect(visible({ enabled: true, count: 9 })).toBe(false); expect(visible({ enabled: true, count: 10 })).toBe(true);
    expect(evaluateConfiguredQuestions({ insuranceConfiguration: source }, { commercial: { turnover: 1 }, enabled: false, count: 20 })).toEqual([]);
  });
});
