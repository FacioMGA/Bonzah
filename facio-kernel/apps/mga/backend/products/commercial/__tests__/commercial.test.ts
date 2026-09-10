import { describe, expect, it } from 'vitest';
import { resolveJurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import { resolveCommercialPolicyPeriod } from '../policyPeriod.js';
import { readFileSync } from 'node:fs';
import Handlebars from 'handlebars';
import { calculateCommercial, validateCommercialConfiguration } from '../pricing.js';
import { syntheticCommercialConfiguration, commercialContext } from './fixtures.js';
import { commercialGoldenFixtures } from '../goldenFixtures.js';
import { buildCommercialDocViewModel } from '../documents/viewModel.js';
import { commercialProductRuntimeConfig } from '../runtime.js';
import { CommercialProductAdapter } from '../CommercialProductAdapter.js';
import { configurationPublicationIssues, validateInsuranceConfigurationComponents } from '../../../modules/insuranceConfiguration/domain/runtimeConfiguration.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../platform/tenant/tenantConfig.js';
import type { DocPackContext } from '../../shared/documents/genericDocPackGenerator.js';

const quote = () => structuredClone(commercialGoldenFixtures.minimumValid);
const tenant = (id: string): TenantConfig => ({ id, tenantSlug: id, countryCode: 'GB', country: 'United Kingdom', currency: 'GBP', ipt: {}, adminFee: 0, legalPack: 'synthetic', publicBaseUrl: 'https://example.invalid', fromEmail: 'training@example.invalid', brandLogo: { white: '', blue: '' } });
new CommercialProductAdapter();
describe('registered Symphony commercial product', () => {
  it('limits jurisdiction availability to trusted active synthetic tenants and preserves exact selected dates', () => {
    const tenant = { countryCode: 'CY', kind: 'SYNTHETIC', status: 'ACTIVE', parentOrganizationId: 'training-org' };
    const resolved = resolveJurisdictionProductConfig({ productCode: 'COMMERCIAL', tenant });
    expect(resolved.taxRegime.profileCode).toBe('CY_COMMERCIAL_SYNTHETIC_NO_TAX');
    expect(resolved.documentConfig.wordingReference).not.toMatch(/Abbeygate|Volante|BRIT/);
    for (const change of [{ kind: 'LIVE' }, { status: 'SUSPENDED' }, { parentOrganizationId: '' }, { countryCode: 'GB' }]) {
      expect(() => resolveJurisdictionProductConfig({ productCode: 'COMMERCIAL', tenant: { ...tenant, ...change } })).toThrow();
    }
    const period = resolveCommercialPolicyPeriod({ policy: { startDate: '2027-02-01', endDate: '2027-06-17' } });
    expect(period.expiryDate.toISOString().slice(0, 10)).toBe('2027-06-17');
    expect(() => resolveCommercialPolicyPeriod({ policy: { startDate: '2027-02-30', endDate: '2027-06-17' } })).toThrow();
    expect(() => resolveCommercialPolicyPeriod({ policy: { startDate: '2027-02-01', endDate: '2029-06-17' } })).toThrow(/one year/);
  });

  it('uses the source percentage basis, band, limit/excess factors, timed loadings and floor with explainable trace', () => {
    const config = syntheticCommercialConfiguration();
    const calc = config.product.details.calculationsByCoverage!['Training liability'];
    calc.turnoverBands = [{ from: '0', to: '200000', multiplier: '1.2' }];
    calc.ilfSumMatrix = [{ coverageLimit: '100000', factorsByCoverage: { 'Training liability': '1.5' } }];
    calc.ilfExcessMatrix = [{ deductible: '100', factor: '0.8' }];
    calc.loadingsExtensions = [{ id: 'loading', name: 'Training loading', factor: '1.1', appliedAlways: true, applyTiming: 'after-base-premium' }];
    const result = calculateCommercial(quote(), commercialContext(config), 'GBP');
    expect(result.premium).toBe(792); expect(result.outputs[0].output.breakdown?.auditTrail?.length).toBeGreaterThan(4);
    calc.minimumPremiumFloor = 1000;
    expect(calculateCommercial(quote(), commercialContext(config), 'GBP').premium).toBe(1000);
  });
  it('applies authored risk minimums and rejects missing configured bands, factors and invalid loading instructions', () => {
    const config = syntheticCommercialConfiguration(), calc = config.product.details.calculationsByCoverage!['Training liability'];
    calc.riskCodeTable![0].minimumPremium = '700';
    expect(calculateCommercial(quote(), commercialContext(config), 'GBP').premium).toBe(700);
    calc.turnoverBands = [{ from: '0', to: '10', multiplier: '1.2' }];
    expect(() => calculateCommercial(quote(), commercialContext(config), 'GBP')).toThrow(/No configured turnover band/);
    delete calc.turnoverBands; calc.ilfSumMatrix = [{ coverageLimit: '42', factor: '1.2' }];
    expect(() => calculateCommercial(quote(), commercialContext(config), 'GBP')).toThrow(/No configured limit factor/);
    delete calc.ilfSumMatrix; calc.ilfExcessMatrix = [{ deductible: '42', factor: '1.2' }];
    expect(() => calculateCommercial(quote(), commercialContext(config), 'GBP')).toThrow(/No configured deductible factor/);
    delete calc.ilfExcessMatrix; calc.loadingsExtensions = [{ id: 'bad', name: 'Invalid factor', factor: 'not-a-number', appliedAlways: true, applyTiming: 'after-base-premium' }];
    expect(validateCommercialConfiguration(config.product).join(' ')).toMatch(/valid factor/);
  });
  it('prices only ready product lines and refuses ignored source routing, operations, aggregates and cross-currency minimums', () => {
    const config = syntheticCommercialConfiguration();
    config.product.details.productLines = [{ id: 'line', name: 'Training line', triggerSegmentId: 'training-business', linkedCoverages: ['Training liability'], isStandalone: true, basePremiumTable: [{ quantityFrom: '0', quantityTo: '10', fullPremium: '300' }], loadings: [], minimumPremium: [], status: 'Draft' }];
    const line = config.product.details.productLines[0];
    expect(calculateCommercial(quote(), commercialContext(config), 'GBP').premium).toBe(500);
    line.status = 'Ready'; expect(calculateCommercial(quote(), commercialContext(config), 'GBP').premium).toBe(300);
    line.sourceConfig = { basePremium: { sourceType: 'external-table' } };
    expect(validateCommercialConfiguration(config.product).join(' ')).toMatch(/source\/target routing/);
    delete line.sourceConfig; line.loadings = [{ id: 'x', label: 'Loading', factor: '10', appliedAlways: true, applyTiming: 'after-base-premium', operation: 'add' }];
    expect(validateCommercialConfiguration(config.product).join(' ')).toMatch(/multiplicative/);
    line.loadings = []; line.minimumPremium = [{ id: 'min', type: 'Annual Aggregate', currency: 'GBP', perCoverage: { 'Training liability': 500 } }];
    expect(validateCommercialConfiguration(config.product).join(' ')).toMatch(/aggregate minimum/);
    line.minimumPremium[0].type = 'Per Occurrence'; line.minimumPremium[0].currency = 'USD';
    expect(() => calculateCommercial(quote(), commercialContext(config), 'GBP')).toThrow(/no currency conversion/);
  });
  it('changes only the selected published programme inputs and retains old snapshot wording/price in schedules', async () => {
    const a = commercialContext(), b = commercialContext(syntheticCommercialConfiguration(), 'definition-b');
    const original = JSON.stringify(a);
    const changed = syntheticCommercialConfiguration(); changed.product.name = 'Changed training'; changed.product.details.calculationsByCoverage!['Training liability'].riskCodeTable![0].baseRate = '1';
    const next = commercialContext(changed, 'definition-next');
    await runWithOperatingTenant(tenant('tenant-a'), async () => {
      const previous = await commercialProductRuntimeConfig.buildQuoteResponse(quote(), a);
      expect(previous.quoteResponse.primaryOption).toMatchObject({ annualPremium: 500 });
      expect((await commercialProductRuntimeConfig.buildQuoteResponse(quote(), next)).quoteResponse.primaryOption).toMatchObject({ annualPremium: 1000 });
      const model = buildCommercialDocViewModel({ policy: { policyNumber: 'SYNTHETIC-1' }, snapshot: { programDefinition: a.programDefinition, quoteResponse: previous.quoteResponse }, quoteData: quote(), documentSources: [], riskTransactionId: null } as unknown as DocPackContext);
      const html = Handlebars.compile(readFileSync(new URL('../documents/templates/schedule.html', import.meta.url), 'utf8'))(model);
      expect(html).toContain('GBP 500'); expect(html).toContain('Training wording'); expect(html).toContain('No insurance cover is provided'); expect(html).toContain('definition-a'); expect(html).not.toContain('Changed training');
    });
    expect(calculateCommercial(quote(), b, 'GBP').premium).toBe(500); expect(JSON.stringify(a)).toBe(original);
  });
  it('fails closed on unconfigured cover/segment/limit/deductible/model/currency or inactive product', () => {
    const context = commercialContext();
    for (const change of [ { segmentId: 'unknown' }, { coverages: [{ coverage: 'Other', limit: 100, excess: 0 }] }, { coverages: [{ coverage: 'Training liability', limit: 1000001, excess: 100 }] }, { coverages: [{ coverage: 'Training liability', limit: 1000, excess: 0 }] } ]) {
      expect(() => calculateCommercial({ ...quote(), commercial: { ...(quote().commercial as object), ...change } }, context, 'GBP')).toThrow();
    }
    expect(() => calculateCommercial(quote(), undefined, 'GBP')).toThrow(/published/);
    expect(() => calculateCommercial(quote(), context, 'JPY')).toThrow(/two-decimal/);
    const config = syntheticCommercialConfiguration(); config.product.active = false;
    expect(() => calculateCommercial(quote(), commercialContext(config), 'GBP')).toThrow(/not active/);
  });
  it('excludes a hidden retained answer from conditional loadings on the first price evaluation', () => {
    const config = syntheticCommercialConfiguration();
    config.product.details.proposalQuestionGroups[0].questions.push({ id: 'exposed', slug: 'exposed', field: 'Exposure enabled', answerType: 'Boolean', coverage: 'All', required: true }, { id: 'loading', slug: 'loading', field: 'Loading', answerType: 'Boolean', coverage: 'All', openIf: 'exposed=TRUE' });
    config.product.details.calculationsByCoverage!['Training liability'].loadingsExtensions = [{ id: 'conditional', name: 'Conditional loading', factor: '2', appliedAlways: false, questionnaireKey: 'loading', applyTiming: 'after-all-rules' }];
    expect(calculateCommercial({ ...quote(), exposed: false, loading: true }, commercialContext(config), 'GBP').premium).toBe(500);
    expect(calculateCommercial({ ...quote(), exposed: true, loading: true }, commercialContext(config), 'GBP').premium).toBe(1000);
  });
  it('allows source commercial coverage/rates only for the registered adapter and checks generated components', () => {
    const config = syntheticCommercialConfiguration();
    expect(configurationPublicationIssues(config, 'COMMERCIAL')).toEqual([]);
    expect(configurationPublicationIssues(config, 'HOME').length).toBeGreaterThan(0);
    const def = commercialContext(config).programDefinition!;
    expect(() => validateInsuranceConfigurationComponents(def, 'COMMERCIAL')).not.toThrow();
    def.questionnaire = { ...def.questionnaire, sections: [] };
    expect(() => validateInsuranceConfigurationComponents(def, 'COMMERCIAL')).toThrow(/generated/);
    config.product.coverageSections[0].maxLimit = '-1'; expect(validateCommercialConfiguration(config.product).length).toBeGreaterThan(0);
  });
});
