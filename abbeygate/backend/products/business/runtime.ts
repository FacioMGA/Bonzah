import { businessManifest } from '@facio/products';
import { buildManualReferralRuntimeConfig } from '../referralManualRuntime.js';

type JsonObject = { [k: string]: unknown };

const businessGoldenQuoteData = {
  manualPremium: 1,
  proposer: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    dateOfBirth: '1990-01-01',
    email: 'ada@example.com',
    phone: '+35799123456',
    nationality: 'Cyprus',
    idNumber: 'CY123456',
    occupation: 'Director',
    address: {
      line1: '1 Market Street',
      city: 'Nicosia',
      province: 'Nicosia',
      postcode: '1010',
      country: 'Cyprus',
    },
    hearAboutUs: 'google',
    marketingConsent: false,
  },
  business: {
    typeOfBusiness: 'Retail shop',
    numberOfEmployees: 3,
    yearPremisesConstructed: 2000,
    sizeOfPremisesSqm: 120,
    coverTiming: 'asap',
    registeredForTax: 'yes',
    premisesStatus: 'rented',
  },
  coverage: {
    buildings: 0,
    stock: 10000,
    equipment: 5000,
    publicLiability: 'yes',
    publicLiabilityLimit: 1000000,
    employersLiability: 'no',
    employersLiabilityLimit: 0,
    businessInterruption: 'yes',
    businessInterruptionLimit: 25000,
    businessInterruptionIndemnityMonths: 12,
    legalAssistance: 'no',
  },
  proposal: {
    marketName: 'Manual Market',
    status: 'ready_to_send',
    coverageRows: [{ coverage: 'Commercial package', limit: 'As requested', excess: 'As agreed', premium: 1 }],
    termsNotes: 'Subject to manual underwriter confirmation.',
    subjectivities: 'None for fixture.',
  },
  security: {
    rejasOnWindowsAndDoors: 'yes',
    alarm: 'yes',
    fireResponseEquipment: 'extinguishers',
    mainDoor: 'solid_wood',
    secondDoor: 'metallic',
    windows: 'iron_or_steel_bars',
    shopWindow: 'glass',
  },
  declarations: {
    informationAccurate: true,
  },
};

export const businessProductRuntimeConfig = buildManualReferralRuntimeConfig({
  productType: 'BUSINESS',
  displayName: 'Business Insurance',
  manifest: businessManifest,
  publicSessionSlug: 'business',
  publicEntryPath: '/quote/business/new',
  firstStep: 'proposer',
  customerJourney: { pricingStep: 'business-details', uwStep: 'business-details', detailsStep: 'proposer' },
  versionSection: 'Business',
  versionCoverageLabel: 'Commercial package',
  bdxClassOfBusiness: 'COMMERCIAL',
  goldenFixtures: {
    minimumValid: businessGoldenQuoteData,
    minimumIssuable: businessGoldenQuoteData,
    referral: {},
  },
  premiumFromQuoteData: (quoteData) => {
    const manualPremium = numeric(asRecord(quoteData).manualPremium);
    if (manualPremium > 0) return manualPremium;
    const rowsPremium = coverageRows(quoteData).reduce((sum, row) => sum + numeric(row.premium), 0);
    return rowsPremium;
  },
  normalizeProductFields: (quoteData) => ({
    proposer: asRecord(quoteData.proposer),
    business: asRecord(quoteData.business),
    coverage: asRecord(quoteData.coverage),
    proposal: asRecord(quoteData.proposal),
    security: asRecord(quoteData.security),
  }),
  buildInsuredValueDisplay: (quoteData) => {
    const rows = coverageRows(quoteData);
    if (rows.length > 0) {
      const premium = rows.reduce((sum, row) => sum + numeric(row.premium), 0);
      return premium > 0
        ? `${rows.length} manual coverage row${rows.length === 1 ? '' : 's'} / €${premium.toLocaleString()}`
        : `${rows.length} manual coverage row${rows.length === 1 ? '' : 's'}`;
    }
    const coverage = asRecord(quoteData.coverage);
    const parts = [
      amountLabel('Buildings', coverage.buildings),
      amountLabel('Stock', coverage.stock),
      amountLabel('Equipment', coverage.equipment),
      amountLabel('BI', coverage.businessInterruptionLimit),
    ].filter(Boolean);
    return parts.join(' / ') || 'Manual commercial review';
  },
});

function coverageRows(quoteData: unknown): JsonObject[] {
  const proposal = asRecord(asRecord(quoteData).proposal);
  return Array.isArray(proposal.coverageRows) ? proposal.coverageRows.map(asRecord) : [];
}

function amountLabel(label: string, value: unknown): string | null {
  const amount = Number(value || 0);
  return amount > 0 ? `${label} €${amount.toLocaleString()}` : null;
}

function numeric(value: unknown): number {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
