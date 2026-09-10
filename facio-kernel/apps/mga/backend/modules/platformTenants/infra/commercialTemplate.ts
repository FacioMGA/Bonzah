import { CommercialProductAdapter } from '../../../products/commercial/CommercialProductAdapter.js';
import { buildDefaultProgramMbeProductConfig } from '../../mbe/domain/programProduct.js';
import { compileProcessChannels, compileProposalQuestionnaire, insuranceConfigurationSchema } from '../../insuranceConfiguration/domain/runtimeConfiguration.js';
import { contentHash, json, type ReusableTenantTemplate } from './templates.js';

/** Explicit synthetic prices exercise the existing Symphony percentage engine; no customer rate or authority is cloned. */
export function createReusableCommercialTemplate(): ReusableTenantTemplate {
  const adapter = new CommercialProductAdapter();
  const insuranceConfiguration = insuranceConfigurationSchema.parse({ schemaVersion: 1,
    process: { businessDescription: 'Synthetic commercial training', considerations: [], recommendedPackage: 'QUOTE_SYMPHONY',
      customers: { forms: true, approve: true, docs: true, portal: false, pay: false, claim: false, cancel: false },
      agents: { enabled: false, contractTypes: [], deltaBonus: [], commissionMode: 'none', showExpectedCommission: false, cancellationRule: 'proRata', permissions: [] } },
    product: { name: 'Synthetic commercial training', classOfBusinessKey: 'training', status: 'Active', active: true,
      coverageSections: [{ classOfBusinessKey: 'training', coverageName: 'Training liability', includedClauseIds: [], excludedClauseIds: [], territorialLimit: 'Synthetic sandbox only', notes: 'No real insurance authority', maxLimit: '1000000', deductible: '100' }],
      details: { proposalQuestionGroups: [{ name: 'Commercial risk', questions: [{ id: 'turnover', slug: 'commercial.turnover', field: 'Annual turnover', answerType: 'Number', coverage: 'All', required: true, settings: { minNumber: 0, maxNumber: 1000000000 } }] }],
        primaryCoverage: { kind: 'Training liability' }, professions: [{ section: 'Training', profession: 'Training business', segmentId: 'training-business', calcMethod: 'Risk Code', riskCodesByCoverage: { 'Training liability': 'TRAINING-1' } }],
        calculationsByCoverage: { 'Training liability': { riskCodeTable: [{ code: 'TRAINING-1', baseRate: '0.5' }], minimumPremiumFloor: 100, enforceMinimumPremium: true } } } } });
  const configuration = {
    underwriting: json({ schemaVersion: 1, mode: 'automatic_acceptance', reason: 'Synthetic training rules only; no insurer acceptance.' }),
    coverage: json(buildDefaultProgramMbeProductConfig({ productType: 'COMMERCIAL', programCode: 'commercial', catalog: { productType: 'COMMERCIAL', get: code => adapter.getEndorsementTemplate(code), getAll: () => adapter.getEndorsementCatalog(), getGroups: () => adapter.getEndorsementGroups() } })),
    questionnaire: json({ ...compileProposalQuestionnaire(insuranceConfiguration.product, false, { productType: 'COMMERCIAL', version: 1 }), claimsContract: { version: 1, fnol: { incidentTypes: [], thirdPartyKinds: [], rules: { minDescriptionLength: 10, allowedCountries: ['Cyprus'], requiresThirdPartyFor: [], requiresPoliceFor: [] } }, fullClaimForm: { fields: [], source: 'metadata' } } }),
    workflow: json({ insuranceConfiguration, referralOnly: false, externalIssuance: { mode: 'NONE' } }),
    channels: json(compileProcessChannels(insuranceConfiguration)),
    ratingTables: json({ schemaVersion: 1, engine: 'symphony-commercial-v1', configurationSource: 'programme_definition' }),
    ratingStages: json([{ id: 'commercial', operator: 'symphony-commercial-v1' }]),
    documentSources: json([{ documentType: 'COMMERCIAL_SCHEDULE_PDF', sourceId: 'commercial-schedule', sourceVersion: 'v1' }]),
  };
  const basis = { id: 'commercial-cy-synthetic', version: 2, sourceCommit: 'f85219459e6a888996d3d3af731b6d45a98fde94', countryCode: 'CY' as const, country: 'Cyprus', currency: 'EUR', legalPack: 'cy' as const,
    product: { code: 'COMMERCIAL', name: 'Commercial insurance', icon: 'briefcase-business', classOfBusiness: 'COMMERCIAL', riskCode: 'TRAINING', programCode: 'commercial' }, configuration };
  return { ...basis, view: { id: basis.id, version: basis.version, hash: contentHash(basis), name: 'Commercial insurance · configured Symphony pricing · synthetic training', jurisdiction: 'CY', currency: 'EUR', productCodes: ['COMMERCIAL'], kind: 'SYNTHETIC', sourceCommit: basis.sourceCommit,
    limitations: ['Synthetic 0.5 percent turnover rate and 100 minimum premium exercise the imported Symphony engine; no customer rating approval is implied.', 'No insurer authority, external provider, payment collection or customer document approval.', 'New-business quote/bind and retained schedule only; commercial servicing requires separately configured transaction rules.'] } };
}
