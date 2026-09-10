import { homeManifest, travelManifest, healthManifest, motorManifest, type ProductManifest } from '@facio/products';
import { TravelProductAdapter } from '../../../products/travel/TravelProductAdapter.js';
import { HealthProductAdapter } from '../../../products/health/HealthProductAdapter.js';
import { MotorProductAdapter } from '../../../products/motor/MotorProductAdapter.js';
import { loadBritTravelRates } from '../../../products/travel/pricing/data/loader.js';
import { loadTravelFeeBands } from '../../../products/travel/pricing/data/travel-fee-bands.loader.js';
import { loadBritHealthRates } from '../../../products/health/pricing/data/loader.js';
import { loadAbbeygateAutoCyprus2022Matrix, loadClassicCarRates } from '../../../products/motor/pricing/data/loader.js';
import { MOTOR_RATING_PIPELINE } from '../../../products/motor/pricing/programRatingModel.js';
import { DEFAULT_TRAVEL_UW_CONFIG, parseTravelUwConfig } from '../../../products/travel/underwriting/travelUwAutomation.js';
import { DEFAULT_HEALTH_UW_CONFIG, parseHealthUwConfig } from '../../../products/health/underwriting/healthUwAutomation.js';
import { buildDefaultProgramMbeProductConfig } from '../../mbe/domain/programProduct.js';
import { createReusableCommercialTemplate } from './commercialTemplate.js';
import { contentHash, createReusableHomeTemplate, json, type ReusableTenantTemplate } from './templates.js';
import { SYNTHETIC_MOTOR_UNDERWRITING_V1 } from './syntheticMotorUnderwriting.js';

const jurisdictions = { CY: { country: 'Cyprus', legalPack: 'cy' }, PT: { country: 'Portugal', legalPack: 'pt' }, ES: { country: 'Spain', legalPack: 'es' }, GR: { country: 'Greece', legalPack: 'gr' } } as const;
type Jurisdiction = keyof typeof jurisdictions;
type SourceProduct = 'HOME' | 'TRAVEL' | 'HEALTH' | 'MOTOR';
const documents = {
  TRAVEL: [{ documentType: 'TRAVEL_CERTIFICATE_PDF', sourceId: 'travel-certificate', sourceVersion: 'v1' }, { documentType: 'TRAVEL_SCHEDULE_PDF', sourceId: 'travel-schedule', sourceVersion: 'v3-cv1020-sanctions' }, { documentType: 'TRAVEL_STATEMENT_OF_FACT_PDF', sourceId: 'travel-statement-of-fact', sourceVersion: 'v1' }],
  HEALTH: [{ documentType: 'HEALTH_CERTIFICATE_PDF', sourceId: 'health-certificate', sourceVersion: 'v2' }, { documentType: 'HEALTH_SCHEDULE_PDF', sourceId: 'health-schedule', sourceVersion: 'v3-cv1020-sanctions' }, { documentType: 'HEALTH_STATEMENT_OF_FACT_PDF', sourceId: 'health-statement-of-fact', sourceVersion: 'v2' }],
  MOTOR: [{ documentType: 'MOTOR_QUOTE_PDF', sourceId: 'motor-quote', sourceVersion: 'v1' }, { documentType: 'MOTOR_CERTIFICATE_PDF', sourceId: 'motor-certificate', sourceVersion: 'v2' }, { documentType: 'MOTOR_SCHEDULE_PDF', sourceId: 'motor-schedule', sourceVersion: 'v3-cv1020-sanctions' }, { documentType: 'MOTOR_STATEMENT_OF_FACT_PDF', sourceId: 'motor-statement-of-fact', sourceVersion: 'v1' }],
};
function questionnaire(manifest: ProductManifest, country: string) {
  const fields = manifest.questionnaire.sections.flatMap(section => section.fields);
  return json({ requiredness: Object.fromEntries(fields.filter(field => field.required === true).map(field => [field.path, true])),
    sections: manifest.questionnaire.sections.map(section => ({ id: section.id, title: section.title, questions: section.fields.map(field => ({ ...field, key: field.path })) })),
    claimsContract: { version: 1, fnol: { incidentTypes: [], thirdPartyKinds: [], rules: { minDescriptionLength: 10, allowedCountries: [country], requiresThirdPartyFor: [], requiresPoliceFor: [] } }, fullClaimForm: { fields: [], source: 'metadata' } } });
}
/** Registered source territories only. No runtime country fallback, customer seed records or currency conversion. */
export function createReusableSourceTemplate(productCode: SourceProduct, countryCode: Jurisdiction): ReusableTenantTemplate {
  if ((productCode === 'HEALTH' || productCode === 'MOTOR') && countryCode !== 'CY') throw new Error(`${productCode} has no registered non-Cyprus pricing/underwriting template`);
  const home = createReusableHomeTemplate();
  if (productCode === 'HOME' && countryCode === 'CY') return home;
  const jurisdiction = jurisdictions[countryCode];
  const configuration = structuredClone(home.configuration);
  let name = 'Home insurance', icon = 'home', classOfBusiness = 'PROPERTY', riskCode = 'HH';
  if (productCode === 'HOME') configuration.questionnaire = questionnaire(homeManifest, jurisdiction.country);
  else {
    const adapter = productCode === 'TRAVEL' ? new TravelProductAdapter() : productCode === 'HEALTH' ? new HealthProductAdapter() : new MotorProductAdapter();
    const manifest = productCode === 'TRAVEL' ? travelManifest : productCode === 'HEALTH' ? healthManifest : motorManifest;
    name = productCode === 'TRAVEL' ? 'Travel insurance' : productCode === 'HEALTH' ? 'Immigration medical insurance' : 'Motor insurance';
    icon = productCode === 'TRAVEL' ? 'plane' : productCode === 'HEALTH' ? 'heart-pulse' : 'car';
    classOfBusiness = productCode; riskCode = productCode === 'TRAVEL' ? 'TE' : productCode === 'HEALTH' ? 'PA' : 'MC';
    configuration.underwriting = json(productCode === 'TRAVEL' ? parseTravelUwConfig(DEFAULT_TRAVEL_UW_CONFIG) : productCode === 'HEALTH' ? parseHealthUwConfig(DEFAULT_HEALTH_UW_CONFIG) : SYNTHETIC_MOTOR_UNDERWRITING_V1);
    configuration.coverage = json(buildDefaultProgramMbeProductConfig({ productType: productCode, catalog: { productType: productCode, get: code => adapter.getEndorsementTemplate(code), getAll: () => adapter.getEndorsementCatalog(), getGroups: () => adapter.getEndorsementGroups() } }));
    configuration.questionnaire = questionnaire(manifest, jurisdiction.country);
    configuration.ratingTables = json(productCode === 'TRAVEL' ? { rateCard: loadBritTravelRates(), adminFees: loadTravelFeeBands() } : productCode === 'HEALTH' ? loadBritHealthRates() : { ...loadAbbeygateAutoCyprus2022Matrix(), classicRates: loadClassicCarRates() });
    configuration.ratingStages = json(productCode === 'MOTOR' ? MOTOR_RATING_PIPELINE.map(operator => ({ id: operator, operator })) : []);
    configuration.documentSources = json(documents[productCode]);
  }
  const basis = { id: `${productCode.toLowerCase()}-${countryCode.toLowerCase()}-synthetic`, version: 1, sourceCommit: home.view.sourceCommit, countryCode, ...jurisdiction, currency: 'EUR',
    product: { code: productCode, name, icon, classOfBusiness, riskCode, programCode: `abbeygate_${productCode.toLowerCase()}` }, configuration };
  return { ...basis, view: { id: basis.id, version: 1, hash: contentHash(basis), name: `${name} · ${jurisdiction.country} · synthetic training`, jurisdiction: countryCode, currency: 'EUR', productCodes: [productCode], kind: 'SYNTHETIC', sourceCommit: basis.sourceCommit,
    limitations: ['Explicit pinned source engine, rates and questionnaires for synthetic exercise. No customer policyholders, policies or credentials are copied.', 'No insurer delegation, regulatory approval, live provider, payment or delivery connection. Issued training documents carry synthetic authority only.', 'Archived customer wording, IPIDs, Green Cards and provider assistance documents are not selected by this template.', ...(productCode === 'HEALTH' ? ['Cyprus expatriate immigration medical only, matching source underwriting.'] : []), ...(productCode === 'MOTOR' ? ['Cyprus source matrix only; other Motor territories need reviewed rate data and authority.'] : [])] } };
}
export function createReusableTemplateCatalog(): ReusableTenantTemplate[] {
  const individual: ReusableTenantTemplate[] = [];
  for (const country of Object.keys(jurisdictions) as Jurisdiction[]) for (const product of ['HOME', 'TRAVEL'] as const) individual.push(createReusableSourceTemplate(product, country));
  individual.push(createReusableSourceTemplate('HEALTH', 'CY'), createReusableSourceTemplate('MOTOR', 'CY'), createReusableCommercialTemplate());
  const portfolios = (Object.keys(jurisdictions) as Jurisdiction[]).map(country => {
    const selected = individual.filter(template => template.countryCode === country);
    const primary = selected.find(template => template.view.productCodes[0] === 'HOME')!;
    const additionalTemplates = selected.filter(template => template !== primary);
    const basis = { id: `mga-${country.toLowerCase()}-synthetic`, version: Math.max(...selected.map(template => template.view.version)), sourceCommit: primary.view.sourceCommit, templates: selected.map(template => ({ id: template.view.id, version: template.view.version, hash: template.view.hash })) };
    return { ...structuredClone(primary), additionalTemplates, view: { ...primary.view, id: basis.id, version: basis.version, hash: contentHash(basis), name: `MGA workspace · ${jurisdictions[country].country} · all registered training products`, productCodes: selected.flatMap(template => template.view.productCodes), limitations: [...new Set(selected.flatMap(template => template.view.limitations))] } };
  });
  return [...portfolios, ...individual];
}
