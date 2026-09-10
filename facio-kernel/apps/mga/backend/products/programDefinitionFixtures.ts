import { MOTOR_UW_CONFIG_FIXTURE } from '../test/fixtures/motor/underwriting.js';
import { DEFAULT_HOME_UW_CONFIG } from './home/underwriting/homeUwAutomation.js';
import { DEFAULT_TRAVEL_UW_CONFIG } from './travel/underwriting/travelUwAutomation.js';
import { DEFAULT_HEALTH_UW_CONFIG } from './health/underwriting/healthUwAutomation.js';
import type { MotorProductKitV1 } from '../modules/programs/domain/productKit/productKit.js';
import { loadAbbeygateAutoCyprus2022Matrix, loadClassicCarRates } from './motor/pricing/data/loader.js';
import { loadHomeRates } from './home/pricing/data/loader.js';
import { loadBritTravelRates } from './travel/pricing/data/loader.js';
import { loadTravelFeeBands } from './travel/pricing/data/travel-fee-bands.loader.js';
import { loadBritHealthRates } from './health/pricing/data/loader.js';
import { MOTOR_RATING_PIPELINE } from './motor/pricing/programRatingModel.js';

const AUTOMATED_UNDERWRITING: Record<string, object> = {
  MOTOR: MOTOR_UW_CONFIG_FIXTURE,
  HOME: DEFAULT_HOME_UW_CONFIG,
  TRAVEL: DEFAULT_TRAVEL_UW_CONFIG,
  HEALTH: DEFAULT_HEALTH_UW_CONFIG,
};

/** Test-only, complete document authority for programme-definition fixtures. */
export function fixtureProductKit(programCode: string): MotorProductKitV1 {
  return {
    schemaVersion: 1,
    programCode,
    brand: {
      brokerDisplayName: 'Fixture Insurance',
      brokerLegalName: 'Fixture Insurance Ltd',
      brokerAddressMultiline: '1 Fixture Street\nTest City\n0000\nTest Country',
      brokerAddressOneLine: '1 Fixture Street, Test City, 0000, Test Country',
      brokerRegulatoryLine: 'Fixture regulatory line',
      uwTeamName: 'Fixture Underwriting',
      coverholderStatement: 'Fixture Insurance is the authorised coverholder.',
      dataControllerName: 'Fixture Insurance Ltd',
      greenCardAuthority: 'Fixture Green Card Bureau',
      greenCardIssuerName: 'Fixture Insurance Ltd',
      greenCardIssuerAddress: '1 Fixture Street, Test City, 0000, Test Country',
      uwSignatureAsset: 'fixture-signature.png',
    },
  };
}

function fixtureRequiredIssuedDocTypes(productType: string): string[] {
  switch (productType) {
    case 'MOTOR': return ['MOTOR_CERTIFICATE_PDF'];
    case 'HOME': return ['HOME_SCHEDULE_PDF'];
    case 'TRAVEL': return ['TRAVEL_CERTIFICATE_PDF'];
    case 'HEALTH': return ['HEALTH_CERTIFICATE_PDF'];
    default: return [];
  }
}

/**
 * Test-only product capability mappings. These deliberately exercise the
 * published-definition schema without becoming a runtime source of values.
 */
function fixtureDocumentSources(productType: string): Array<{ documentType: string; sourceId: string; sourceVersion: string }> {
  switch (productType) {
    case 'MOTOR': return [
      { documentType: 'MOTOR_QUOTE_PDF', sourceId: 'motor-quote', sourceVersion: 'v1' },
      { documentType: 'MOTOR_CERTIFICATE_PDF', sourceId: 'motor-certificate', sourceVersion: 'v2' },
      { documentType: 'MOTOR_GREEN_CARD_PDF', sourceId: 'motor-green-card', sourceVersion: 'v2' },
      { documentType: 'MOTOR_SCHEDULE_PDF', sourceId: 'motor-schedule', sourceVersion: 'v3-cv1020-sanctions' },
      { documentType: 'MOTOR_STATEMENT_OF_FACT_PDF', sourceId: 'motor-statement-of-fact', sourceVersion: 'v1' },
      { documentType: 'MOTOR_POLICY_WORDING_PDF', sourceId: 'motor-policy-wording-by-territory', sourceVersion: 'jurisdiction:v1' },
      { documentType: 'MOTOR_ENDORSEMENT_SCHEDULE_PDF', sourceId: 'motor-endorsement-schedule', sourceVersion: 'v2-cv1020-sanctions' },
    ];
    case 'HOME': return [
      { documentType: 'HOME_SCHEDULE_PDF', sourceId: 'home-schedule', sourceVersion: 'v4-footer-clearance' },
      { documentType: 'HOME_STATEMENT_OF_FACT_PDF', sourceId: 'home-statement-of-fact', sourceVersion: 'v1' },
      { documentType: 'HOME_IPID_PDF', sourceId: 'home-ipid-by-territory', sourceVersion: 'adr-0048:v1' },
      { documentType: 'HOME_POLICY_WORDING_PDF', sourceId: 'home-policy-wording-by-territory-and-domicile', sourceVersion: 'adr-0048:v1' },
      { documentType: 'HOME_EUROP_ASSISTANCE_PDF', sourceId: 'home-europ-assistance', sourceVersion: '2026-04-07' },
    ];
    case 'TRAVEL': return [
      { documentType: 'TRAVEL_CERTIFICATE_PDF', sourceId: 'travel-certificate', sourceVersion: 'v1' },
      { documentType: 'TRAVEL_SCHEDULE_PDF', sourceId: 'travel-schedule', sourceVersion: 'v3-cv1020-sanctions' },
      { documentType: 'TRAVEL_STATEMENT_OF_FACT_PDF', sourceId: 'travel-statement-of-fact', sourceVersion: 'v1' },
      { documentType: 'TRAVEL_IPID_PDF', sourceId: 'travel-ipid-by-trip-type', sourceVersion: 'adr-0099:v1' },
      { documentType: 'TRAVEL_POLICY_WORDING_PDF', sourceId: 'travel-policy-wording', sourceVersion: 'brit:2026-08-24' },
      { documentType: 'TRAVEL_MEDICAL_CARD_PDF', sourceId: 'travel-medical-card', sourceVersion: 'v1' },
    ];
    case 'HEALTH': return [
      { documentType: 'HEALTH_SCHEDULE_PDF', sourceId: 'health-schedule', sourceVersion: 'v3-cv1020-sanctions' },
      { documentType: 'HEALTH_CERTIFICATE_PDF', sourceId: 'health-certificate', sourceVersion: 'v2' },
      { documentType: 'HEALTH_STATEMENT_OF_FACT_PDF', sourceId: 'health-statement-of-fact', sourceVersion: 'v2' },
      { documentType: 'HEALTH_IPID_PDF', sourceId: 'health-ipid', sourceVersion: 'brit:2025:a379e7faa1e761aa' },
      { documentType: 'HEALTH_POLICY_WORDING_PDF', sourceId: 'health-policy-wording', sourceVersion: 'brit:2025-10-15:c741cea9bcbfe975' },
    ];
    default: return [];
  }
}

export function fixtureProgrammeDefinition(productType: string) {
  const pricingMode = Object.prototype.hasOwnProperty.call(AUTOMATED_UNDERWRITING, productType) ? 'AUTOMATED' as const : 'MANUAL' as const;
  return {
    id: `definition-${productType.toLowerCase()}`,
    programId: 'fixture-program',
    version: 1,
    pricingMode,
    binderProductAuthorityId: 'fixture-authority',
    underwriting: AUTOMATED_UNDERWRITING[productType] || {},
    coverage: {},
    questionnaire: {
      requiredness: {},
      sections: [{
        id: 'risk',
        title: 'Risk details',
        questions: [{ key: 'risk.reference', label: 'Risk reference', type: 'text' }],
      }],
    },
    workflow: {},
    channels: { questions: true, quote: true, payment: false },
    documents: {
      productKit: fixtureProductKit(`abbeygate_${productType.toLowerCase()}`),
      issuedPack: { requiredTypes: fixtureRequiredIssuedDocTypes(productType) },
      sources: fixtureDocumentSources(productType),
    },
  };
}

/**
 * Test-only imported rating data used to create an explicit persisted-model
 * fixture. Product engines must receive these tables through ratingModel;
 * they never read a runtime asset themselves.
 */
export function fixtureRatingModelTables(productType: string) {
  switch (productType) {
    case 'MOTOR': {
      const matrix = loadAbbeygateAutoCyprus2022Matrix();
      return { ...matrix, classicRates: loadClassicCarRates() };
    }
    case 'HOME': return loadHomeRates();
    case 'TRAVEL': return { rateCard: loadBritTravelRates(), adminFees: loadTravelFeeBands() };
    case 'HEALTH': return loadBritHealthRates();
    default: return null;
  }
}

/** Test-only executable pipeline fixtures; production models must be authored and published explicitly. */
export function fixtureRatingModelStages(productType: string) {
  if (productType === 'MOTOR') {
    return MOTOR_RATING_PIPELINE.map((operator) => ({ id: operator, operator }));
  }
  return [];
}
