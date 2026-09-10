import { describe, expect, it } from 'vitest';
import { processConfigurationSchema, effectiveCustomerCapability } from '../domain/processConfiguration.js';
import { symphonyProductSchema } from '../domain/productConfiguration.js';
import { assertConfiguredJourneyCapability, compileProcessChannels, compileProposalQuestionnaire, configurationPublicationIssues, validateInsuranceConfigurationComponents, type InsuranceConfiguration } from '../domain/runtimeConfiguration.js';
import { evaluateConfiguredQuestions } from '../domain/questionnaireEvaluation.js';

export function insuranceConfigurationFixture(): InsuranceConfiguration {
  return {
    schemaVersion: 1,
    process: { businessDescription: 'Synthetic test programme', considerations: [], recommendedPackage: 'QUOTE_SYMPHONY', customers: { forms: true, approve: true, docs: false, portal: false, pay: true, claim: true, cancel: true }, agents: { enabled: true, contractTypes: ['direct'], deltaBonus: [], commissionMode: 'reports', showExpectedCommission: false, cancellationRule: 'proRata', permissions: ['submitProposals'] } },
    product: { name: 'Synthetic business risk', classOfBusinessKey: null, status: 'Active', active: true, coverageSections: [], details: { proposalQuestionGroups: [{ name: 'Risk', questions: [
      { id: 'employees', slug: 'employees', field: 'Number of employees', answerType: 'Number', coverage: 'All', required: true, settings: { minNumber: 0, maxNumber: 100, decimalPlaces: 0 } },
      { id: 'prior-loss', slug: 'priorLoss', field: 'Prior loss?', answerType: 'Boolean', coverage: 'All', required: true },
      { id: 'details', slug: 'lossDetail', field: 'Loss detail', answerType: 'Long Text', coverage: 'All', openIf: 'priorLoss=TRUE', required: true, settings: { minLength: 5 } },
    ] }] } },
  };
}

describe('Symphony-derived canonical insurance configuration', () => {
  it('retains portal child intent but removes effective capabilities and never grants agent bind', () => {
    const config = insuranceConfigurationFixture();
    expect(config.process.customers.pay).toBe(true);
    expect(effectiveCustomerCapability(config.process, 'pay')).toBe(false);
    expect(compileProcessChannels(config)).toEqual({ questions: true, quote: true, payment: false });
    const workflow = { insuranceConfiguration: config };
    expect(() => assertConfiguredJourneyCapability(workflow, 'customer', 'payment')).toThrow(/does not allow/);
    expect(() => assertConfiguredJourneyCapability(workflow, 'agent', 'quote')).not.toThrow();
    expect(() => assertConfiguredJourneyCapability(workflow, 'agent', 'bind')).toThrow(/does not allow/);
    config.process.agents.enabled = false;
    expect(() => assertConfiguredJourneyCapability(workflow, 'agent', 'quote')).toThrow(/does not allow/);
  });
  it('rejects implicit grants, invalid contract relationships and unknown input properties', () => {
    const process = insuranceConfigurationFixture().process;
    expect(processConfigurationSchema.safeParse({ ...process, customers: { forms: true } }).success).toBe(false);
    expect(processConfigurationSchema.safeParse({ ...process, agents: { ...process.agents, contractTypes: ['sub'] } }).success).toBe(false);
    expect(processConfigurationSchema.safeParse({ ...process, actorId: 'client-forgery' }).success).toBe(false);
  });
  it('maps the exact authored wording and requiredness; rejects a separately edited generated copy', () => {
    const config = insuranceConfigurationFixture();
    const components = { workflow: { insuranceConfiguration: config }, channels: compileProcessChannels(config), questionnaire: compileProposalQuestionnaire(config.product) };
    expect(() => validateInsuranceConfigurationComponents(components)).not.toThrow();
    expect(components.questionnaire.requiredness).toEqual({ employees: ['quote', 'bind'], priorLoss: ['quote', 'bind'], lossDetail: ['quote', 'bind'] });
    expect(() => validateInsuranceConfigurationComponents({ ...components, channels: { ...components.channels, payment: true } })).toThrow(/conflicts/);
    expect(() => validateInsuranceConfigurationComponents({ ...components, questionnaire: { ...components.questionnaire, sections: [] } })).toThrow(/generated/);
  });
  it('enforces missing/invalid answers, conditional requirements, bounds and bool false without truthiness bypass', () => {
    const workflow = { insuranceConfiguration: insuranceConfigurationFixture() };
    expect(evaluateConfiguredQuestions(workflow, { employees: 2, priorLoss: false })).toEqual([]);
    expect(evaluateConfiguredQuestions(workflow, { employees: 101, priorLoss: true })).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'employees' }), expect.objectContaining({ key: 'lossDetail' })]));
    expect(evaluateConfiguredQuestions(workflow, { employees: 2.1, priorLoss: 'random' })).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'employees' }), expect.objectContaining({ key: 'priorLoss' })]));
    expect(evaluateConfiguredQuestions(workflow, { employees: 0, priorLoss: true, lossDetail: 'Minor prior claim' })).toEqual([]);
  });
  it('reports conditional cycles and missing references before publication', () => {
    const config = insuranceConfigurationFixture();
    config.product.details.proposalQuestionGroups[0].questions[1].openIf = 'lossDetail*';
    expect(configurationPublicationIssues(config).join(' ')).toContain('cycle');
    config.product.details.proposalQuestionGroups[0].questions[1].openIf = 'missing=TRUE';
    expect(configurationPublicationIssues(config).join(' ')).toContain('missing question');
  });
  it('retains full source coverage/pricing contracts without pretending unmapped rates or clauses execute', () => {
    const config = insuranceConfigurationFixture();
    config.product.coverageSections = [{ classOfBusinessKey: 'cyber', includedClauseIds: [], excludedClauseIds: [], territorialLimit: 'EU', notes: '', coverageName: 'Cyber', maxLimit: '1,000,000 EUR', deductible: '5,000 EUR' }];
    config.product.details.calculationsByCoverage = { Cyber: { minimumPremiumFloor: 100, enforceMinimumPremium: true, riskCodeTable: [{ code: 'R1', baseRate: '0.1' }], sourceConfig: { basePremiumMatrix: { sourceType: 'questionnaire', sourceObject: 'employees', operation: 'multiply' } } } };
    expect(symphonyProductSchema.parse(config.product)).toEqual(config.product);
    expect(configurationPublicationIssues(config).join(' ')).toContain('commercial rating adapter');
  });
  it('leaves historical definitions without the extension unchanged', () => {
    expect(evaluateConfiguredQuestions({ referralOnly: false }, {})).toEqual([]);
    expect(() => validateInsuranceConfigurationComponents({ workflow: {}, questionnaire: {}, channels: {} })).not.toThrow();
  });
});
