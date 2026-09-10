import { describe, expect, it } from 'vitest';
import { CommercialProductAdapter } from '../../../products/commercial/CommercialProductAdapter.js';
import { HomeProductAdapter } from '../../../products/home/HomeProductAdapter.js';
import { syntheticCommercialConfiguration } from '../../../products/commercial/__tests__/fixtures.js';
import { compileProcessChannels, compileProposalQuestionnaire, validateInsuranceConfigurationComponents } from '../domain/runtimeConfiguration.js';
import { resolveProgramQuestionnaire } from '../../../../frontend/src/modules/policies/config/questionnaires';
new CommercialProductAdapter(); new HomeProductAdapter();

describe('versioned engine and source authoring composition', () => {
  it('materializes contact, term, segment and coverage rows without duplicating an authored engine question', () => {
    const configuration = syntheticCommercialConfiguration();
    configuration.product.details.proposalQuestionGroups[0].questions[0].field = 'Annual business turnover (EUR)';
    const questionnaire = compileProposalQuestionnaire(configuration.product, false, { productType: 'COMMERCIAL', version: 1 });
    expect(questionnaire.sourceCompilerVersion).toBe(3); expect(questionnaire.engineContractVersion).toBe(1);
    const rendered = resolveProgramQuestionnaire({ id: 'published', questionnaire }, { actor: 'underwriter', stage: 'quote' }).flatMap((section) => section.questions);
    const keys = rendered.map((question) => question.key);
    for (const key of ['proposer.companyName', 'proposer.firstName', 'proposer.email', 'proposer.phone', 'proposer.address.line1', 'policy.startDate', 'policy.endDate', 'commercial.segmentId', 'commercial.coverages']) expect(keys).toContain(key);
    expect(keys.filter((key) => key === 'commercial.turnover')).toHaveLength(1);
    expect(rendered.find((question) => question.key === 'commercial.turnover')?.label).toBe('Annual business turnover (EUR)');
    expect(rendered.find((question) => question.key === 'commercial.coverages')?.type).toBe('list');
    const components = { workflow: { insuranceConfiguration: configuration }, questionnaire, channels: compileProcessChannels(configuration) };
    expect(() => validateInsuranceConfigurationComponents(components, 'COMMERCIAL')).not.toThrow();
    expect(() => validateInsuranceConfigurationComponents({ ...components, questionnaire: { ...questionnaire, sections: [] } }, 'COMMERCIAL')).toThrow(/generated/);
    expect(() => validateInsuranceConfigurationComponents({ ...components, questionnaire: { ...questionnaire, engineContractVersion: 999 } }, 'COMMERCIAL')).toThrow(/version/);
  });
  it('keeps old compiler output byte-stable and upgrades only an explicitly new draft', () => {
    const configuration = syntheticCommercialConfiguration();
    const previous = { workflow: { insuranceConfiguration: configuration }, questionnaire: compileProposalQuestionnaire(configuration.product), channels: compileProcessChannels(configuration) };
    const retained = JSON.stringify(previous);
    expect(() => validateInsuranceConfigurationComponents(previous, 'COMMERCIAL')).not.toThrow();
    const next = compileProposalQuestionnaire(configuration.product, false, { productType: 'COMMERCIAL', version: 1 });
    expect(JSON.stringify(previous)).toBe(retained); expect(previous.questionnaire.sourceCompilerVersion).toBe(2);
    expect((next.sections as unknown[]).length).toBeGreaterThan((previous.questionnaire.sections as unknown[]).length);
  });
  it('retains native product inputs when source questions are added without allowing source fields to weaken required engine fields', () => {
    const configuration = syntheticCommercialConfiguration();
    configuration.product.details.proposalQuestionGroups = [{ name: 'Custom detail', questions: [{ id: 'first-name', slug: 'proposer.firstName', field: 'Insured contact name', answerType: 'Short Text', coverage: 'All', required: false }, { id: 'reference', slug: 'training.reference', field: 'Training reference', answerType: 'Short Text', coverage: 'All' }] }];
    const questionnaire = compileProposalQuestionnaire(configuration.product, false, { productType: 'HOME', version: 1 });
    const questions = resolveProgramQuestionnaire({ id: 'home', questionnaire }, { actor: 'underwriter', stage: 'quote' }).flatMap((section) => section.questions);
    expect(questions.some((question) => question.key === 'property.bedrooms')).toBe(true);
    expect(questions.filter((question) => question.key === 'proposer.firstName')).toHaveLength(1);
    expect((questionnaire.requiredness as Record<string, unknown>)['proposer.firstName']).toEqual(['quote', 'bind']);
    expect(questions.some((question) => question.key === 'training.reference')).toBe(true);
    configuration.product.details.proposalQuestionGroups[0].questions[0].answerType = 'Number';
    expect(() => compileProposalQuestionnaire(configuration.product, false, { productType: 'HOME', version: 1 })).toThrow(/conflicts with registered engine type/);
  });
  it('retains an incomplete draft with a structured engine readiness error but blocks strict publication compilation', () => {
    const configuration = syntheticCommercialConfiguration();
    configuration.product.details.proposalQuestionGroups[0].questions[0].slug = 'proposer.firstName';
    configuration.product.details.proposalQuestionGroups[0].questions[0].answerType = 'Number';

    const draft = compileProposalQuestionnaire(configuration.product, true, { productType: 'COMMERCIAL', version: 1 });

    expect(draft.sourceCompilerVersion).toBe(3);
    expect(draft.sourceCompositionError).toEqual(expect.any(String));
    expect(Array.isArray(draft.sections)).toBe(true);
    expect(() => compileProposalQuestionnaire(configuration.product, false, { productType: 'COMMERCIAL', version: 1 })).toThrow();
  });
});
