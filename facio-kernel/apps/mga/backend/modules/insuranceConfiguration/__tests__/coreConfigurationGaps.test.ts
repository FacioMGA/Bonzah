import { describe, expect, it } from 'vitest';
import { configuredCommercialSegments } from '@facio/products';
import { CommercialProductAdapter } from '../../../products/commercial/CommercialProductAdapter.js';
import { calculateCommercial } from '../../../products/commercial/pricing.js';
import { syntheticCommercialConfiguration, commercialContext } from '../../../products/commercial/__tests__/fixtures.js';
import { commercialGoldenFixtures } from '../../../products/commercial/goldenFixtures.js';
import { compileProposalQuestionnaire, configurationPublicationIssues, insuranceConfigurationSchema } from '../domain/runtimeConfiguration.js';
import { configuredPricingAnswers } from '../domain/questionnaireEvaluation.js';
import { ambiguousQuestionAnswerKeys } from '../domain/questionIdentities.js';
import { compileQuestionScope } from '../domain/questionScopes.js';

new CommercialProductAdapter();
const quote = () => structuredClone(commercialGoldenFixtures.minimumValid);
describe('core authored configuration execution', () => {
  it('rejects cross-question ID/slug aliases before hidden answers can change500 into1000', () => {
    const config = syntheticCommercialConfiguration();
    config.product.details.proposalQuestionGroups[0].questions.push(
      { id: 'exposed', slug: 'exposed', field: 'Exposure?', answerType: 'Boolean', coverage: 'All' },
      { id: 'loading', slug: 'unrelated', field: 'Unrelated answer', answerType: 'Boolean', coverage: 'All' },
      { id: 'actual-loading', slug: 'loading', field: 'Apply loading', answerType: 'Boolean', coverage: 'All', openIf: 'exposed=TRUE' },
    );
    config.product.details.calculationsByCoverage!['Training liability'].loadingsExtensions = [{ id: 'conditional', name: 'Conditional loading', factor: '2', appliedAlways: false, questionnaireKey: 'loading', applyTiming: 'after-all-rules' }];
    const data = { ...quote(), exposed: false, unrelated: true, loading: false };
    expect(insuranceConfigurationSchema.safeParse(config).success).toBe(false);
    expect(configurationPublicationIssues(config, 'COMMERCIAL').join(' ')).toContain('answer key loading is ambiguous');
    // This also represents a retained definition that predates stricter authoring validation: it must fail closed, not silently re-price.
    expect(() => calculateCommercial(data, commercialContext(config), 'EUR')).toThrow(/ambiguous/);
    expect(() => configuredPricingAnswers({ insuranceConfiguration: config }, data)).toThrow(/ambiguous/);
    config.product.details.proposalQuestionGroups[0].questions.find((row) => row.slug === 'unrelated')!.id = 'unrelated';
    expect(insuranceConfigurationSchema.safeParse(config).success).toBe(true);
    expect(calculateCommercial(data, commercialContext(config), 'EUR').premium).toBe(500);
    expect(calculateCommercial({ ...data, exposed: true, loading: true }, commercialContext(config), 'EUR').premium).toBe(1000);
    expect(ambiguousQuestionAnswerKeys([{ id: 'same', slug: 'same' }])).toEqual([]);
    expect(ambiguousQuestionAnswerKeys([{ id: 'id-a', slug: 'slug-a' }, { id: 'slug-a', slug: 'slug-b' }])).toEqual(['slug-a']);
  });

  it('routes a Ready line-only segment through the same catalogue used by scope selectors and the UI', () => {
    const config = syntheticCommercialConfiguration();
    config.product.details.productLines = [{ id: 'ready-line', name: 'Configured line', triggerSegmentId: 'line-segment', linkedCoverages: ['Training liability'], isStandalone: true, basePremiumTable: [{ quantityFrom: '0', quantityTo: '10', fullPremium: '300' }], loadings: [], minimumPremium: [], status: 'Ready' }];
    expect(configurationPublicationIssues(config, 'COMMERCIAL')).toEqual([]);
    expect(configuredCommercialSegments(config.product)).toEqual([{ id: 'training-business', name: 'Training business' }, { id: 'line-segment', name: 'line-segment' }]);
    const data = { ...quote(), commercial: { ...(quote().commercial as object), segmentId: 'line-segment', quantity: 1 } };
    expect(calculateCommercial(data, commercialContext(config), 'EUR').premium).toBe(300);
    expect(compileQuestionScope(config.product, { id: 'review', slug: 'review', field: 'Review', answerType: 'Boolean', coverage: 'All', segment: 'line-segment' }, { productType: 'COMMERCIAL', binders: [] })?.selectors).toEqual([{ field: 'commercial.segmentId', values: ['line-segment'] }]);
    config.product.details.productLines[0].status = 'Draft';
    expect(configuredCommercialSegments(config.product)).toHaveLength(1);
    expect(() => calculateCommercial(data, commercialContext(config), 'EUR')).toThrow(/configured profession\/segment/);
    config.product.details.productLines[0].status = 'Ready'; config.product.details.productLines[0].triggerSegmentId = ' invalid ';
    expect(configurationPublicationIssues(config, 'COMMERCIAL').join(' ')).toContain('canonical trigger segment');
  });

  it('retains instructions as read-only paragraph text in new definitions and excludes all informational answers from pricing', () => {
    const config = syntheticCommercialConfiguration();
    config.product.details.proposalQuestionGroups.push({ name: 'Notices', questions: [
      { id: 'notice', slug: 'notice', field: 'Please read', answerType: 'Instruction', body: 'Exact authored instruction\n<script>plain text, never executable</script>', coverage: 'All', required: true },
      { id: 'information', slug: 'information', field: 'Informational notice', answerType: 'Number', coverage: 'All', settings: { informationalOnly: true }, required: true },
    ] });
    const legacy = compileProposalQuestionnaire(config.product, false, { productType: 'COMMERCIAL', version: 1 });
    const retained = JSON.stringify(legacy);
    const current = compileProposalQuestionnaire(config.product, false, { productType: 'COMMERCIAL', version: 1, scopeBindings: [] });
    const rows = (current.sections as { questions: { key: string; type: string; body?: string; requiredAtStages?: string[] }[] }[]).flatMap((row) => row.questions);
    expect(rows.find((row) => row.key === 'notice')).toMatchObject({ type: 'paragraph', body: 'Exact authored instruction\n<script>plain text, never executable</script>' });
    expect(rows.find((row) => row.key === 'information')).toMatchObject({ type: 'paragraph', body: 'Informational notice' });
    expect(rows.find((row) => row.key === 'notice')?.requiredAtStages).toBeUndefined();
    expect(current.requiredness).not.toHaveProperty('notice'); expect(current.requiredness).not.toHaveProperty('information');
    const effective = configuredPricingAnswers({ insuranceConfiguration: config }, { ...quote(), notice: true, information: 999 });
    expect(effective).not.toHaveProperty('notice'); expect(effective).not.toHaveProperty('information');
    expect(JSON.stringify(legacy)).toBe(retained);
  });
});
