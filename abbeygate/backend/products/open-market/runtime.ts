import { openMarketManifest } from '@facio/products';
import { buildManualReferralRuntimeConfig } from '../referralManualRuntime.js';

type JsonObject = { [k: string]: unknown };

const openMarketGoldenQuoteData = {
  proposer: {
    name: 'Ada Lovelace Ltd',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+35799123456',
    address: {
      line1: '1 Market Street',
      city: 'Limassol',
      postcode: '3030',
      country: 'Cyprus',
    },
    dateOfBirth: '1990-01-01',
    nationality: 'Cyprus',
    nif: '123456',
    occupation: 'Director',
    marketingConsent: false,
  },
  risk: {
    lineOfBusiness: 'liability',
    description: 'Manual open-market liability placement',
    targetInceptionDate: '2026-01-01',
  },
  proposal: {
    marketName: 'Manual Market',
    status: 'ready_to_send',
    coverageRows: [{ coverage: 'Liability', limit: 1000000, excess: 500, premium: 1 }],
    termsNotes: 'Subject to manual underwriter confirmation.',
    subjectivities: 'None for fixture.',
  },
  declarations: {
    operatorReviewed: true,
  },
};

export const openMarketProductRuntimeConfig = buildManualReferralRuntimeConfig({
  productType: 'OPEN_MARKET',
  displayName: 'Open Market',
  manifest: openMarketManifest,
  publicSessionSlug: 'open-market',
  publicEntryPath: '/quote/open-market/new',
  firstStep: 'intake',
  customerJourney: { pricingStep: 'manual-proposal', uwStep: 'manual-proposal', detailsStep: 'intake' },
  versionSection: 'Open Market',
  versionCoverageLabel: 'Manual market proposal',
  bdxClassOfBusiness: 'OPEN_MARKET',
  goldenFixtures: {
    minimumValid: openMarketGoldenQuoteData,
    minimumIssuable: openMarketGoldenQuoteData,
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
    risk: asRecord(quoteData.risk),
    proposal: asRecord(quoteData.proposal),
  }),
  buildInsuredValueDisplay: (quoteData) => {
    const rows = coverageRows(quoteData);
    const premium = rows.reduce((sum, row) => sum + numeric(row.premium), 0);
    return premium > 0
      ? `${rows.length} coverage row${rows.length === 1 ? '' : 's'} / €${premium.toLocaleString()}`
      : `${rows.length} coverage row${rows.length === 1 ? '' : 's'}`;
  },
});

function coverageRows(quoteData: unknown): JsonObject[] {
  const proposal = asRecord(asRecord(quoteData).proposal);
  return Array.isArray(proposal.coverageRows) ? proposal.coverageRows.map(asRecord) : [];
}

function numeric(value: unknown): number {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
