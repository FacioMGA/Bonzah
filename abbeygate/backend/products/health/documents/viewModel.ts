import type { DocPackContext } from '../../shared/documents/genericDocPackGenerator.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { resolveJurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import { CV1020_SANCTIONS_CLAUSE, CV1020_HEADING_LINE } from '../../shared/documents/sanctionsClause.js';
import { GESY_CLAIMS_CONDITION } from '../endorsementTemplates.js';
import {
  loadHealthBaseCover,
  loadHealthGhsExtension,
  lookupHealthAgeBandRow,
  resolveHealthAgeBand,
} from '../pricing/data/loader.js';

// Mapped-type form of a loose JSON object — the canonical / wire input
// is `unknown` and gets narrowed structurally; this alias keeps the
// narrowing explicit without re-introducing a polite-any laundering
// shape that the `no-new-any` diff tripwire would flag.
type UnknownRecord = { [k in string]?: unknown };

const COVER_TYPE_LABELS: Record<string, string> = {
  single: 'Single Person',
  couple: 'Couple',
  family: 'Family',
  single_parent_family: 'Single Parent Family',
};

const GENDER_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
};

const ID_TYPE_LABELS: Record<string, string> = {
  passport: 'Passport',
  id_card: 'National ID Card',
  driving_licence: 'Driving Licence',
};

const OCCUPATION_LABELS: Record<string, string> = {
  employed: 'Employed',
  self_employed: 'Self-employed',
  student: 'Student',
  retired: 'Retired',
  other: 'Other',
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€',
  GBP: '£',
  USD: '$',
};

// The Immigration Medical policy's UMR is the bound binder's Unique Market
// Reference — carried on `policy.umr` (mirror set at issuance) and, for
// pre-issuance packs, on `policy.binderUmr` (loaded from the binder). It is
// never fabricated or hard-coded here.
const DEFAULT_POLICY_VERSION = 'AB/IM/01';
const DEFAULT_COVERHOLDER_NAME = 'ABBEYGATE INSURANCE BROKERS LTD';
const DEFAULT_COVERHOLDER_ADDRESS = '1 Mesoyi Avenue, 8028 Paphos, Cyprus';
const DEFAULT_COVERHOLDER_TEL = '00357 26 819 175';
const DEFAULT_COVERHOLDER_FAX = '00357 26 222 991';
const DEFAULT_LLOYDS_JACKET_TITLE = "Lloyd's Insurance Company S.A.";

function asRecord(v: unknown): UnknownRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};
}

function safeStr(v: unknown): string {
  return String(v ?? '').trim();
}

function moneyDisplayFixed(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0,00';
  // pt-style with comma decimal separator to match the sample schedule
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function moneyDisplayInt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('de-DE', { maximumFractionDigits: 0 });
}

function formatDate(input: unknown): string {
  if (input == null || input === '') return '—';
  const d = input instanceof Date ? input : new Date(String(input));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function ageAt(dob: string, atIso?: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const ref = atIso ? new Date(atIso) : new Date();
  if (Number.isNaN(ref.getTime())) return null;
  let age = ref.getFullYear() - d.getFullYear();
  const m = ref.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < d.getDate())) age -= 1;
  return age;
}

function formatExcess(value: number | '10%' | unknown): string {
  if (value === '10%') return '10% Deductible';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `€${moneyDisplayInt(n)} Deductible`;
}

function formatAddress(address: UnknownRecord): string {
  return [
    safeStr(address.line1),
    safeStr(address.line2),
    [safeStr(address.city), safeStr(address.postcode)].filter(Boolean).join(' '),
    safeStr(address.country),
  ].filter(Boolean).join(', ');
}

function formatAddressMultiline(address: UnknownRecord): string {
  return [
    safeStr(address.line1),
    safeStr(address.line2),
    safeStr(address.city),
    safeStr(address.postcode),
    safeStr(address.country),
  ].filter(Boolean).join('\n');
}

/**
 * Build the HEALTH doc-pack view-model from the canonical
 * `quoteData` + `quoteResponse` snapshot. Pure: no DB calls.
 *
 * Mirrors the BRIT Immigration Medical schedule artefact:
 *   - Lloyd's Insurance Company S.A. policy jacket (page 1)
 *   - Abbeygate Schedule (page 2): proposer block + insured persons
 *     table + Sections Applicable + Premium + Cover Provided block
 *     + (if GHS) Extended Cover block.
 *   - Certificate of Insurance (page 3): same structure with
 *     "We certify..." stamp.
 */
export function buildHealthDocViewModel(ctx: DocPackContext): UnknownRecord {
  const policy = ctx.policy;
  const qd = ctx.quoteData;
  const snapshotResp = asRecord(ctx.snapshot.quoteResponse);
  const policyResp = asRecord(snapshotResp.primaryOption);
  const breakdown = asRecord(policyResp.breakdown);

  const insureds = asRecord(qd.insureds);
  const period = asRecord(qd.period);
  const ghs = asRecord(qd.ghs);
  const proposer = asRecord(qd.proposer);
  const proposerAddress = asRecord(proposer.address);

  const inception = safeStr(period.inceptionDate) || (policy.inceptionDate ? policy.inceptionDate.toISOString() : '');
  const expiry = safeStr(period.expiryDate) || (policy.expiryDate ? policy.expiryDate.toISOString() : '');
  const issueDate = new Date().toISOString();

  const coverTypeRaw = safeStr(insureds.coverType || 'single').toLowerCase();
  const coverTypeLabel = COVER_TYPE_LABELS[coverTypeRaw] || coverTypeRaw;

  const personsRaw = Array.isArray(insureds.persons) ? insureds.persons : [];
  const tenantConfig = getTenantConfig();
  const jurisdictionConfig = resolveJurisdictionProductConfig({
    productCode: 'HEALTH',
    tenant: tenantConfig,
  });

  const baseCover = loadHealthBaseCover();
  const ghsExtension = loadHealthGhsExtension();
  const isGhsBeneficiary = ghs.isBeneficiary === true;

  const insuredPersons = personsRaw.map((row: unknown, index: number) => {
    const r = asRecord(row);
    const dob = safeStr(r.dob);
    const age = dob ? ageAt(dob, inception) : null;
    const band = age !== null ? resolveHealthAgeBand(age) : null;
    const bandRow = band ? lookupHealthAgeBandRow(band) : null;
    const fullName = [safeStr(r.firstName), safeStr(r.lastName)].filter(Boolean).join(' ').trim();
    return {
      index,
      ordinal: index + 1,
      fullName,
      idType: ID_TYPE_LABELS[safeStr(r.idType).toLowerCase()] || safeStr(r.idType) || '—',
      idNumber: safeStr(r.idNumber) || '—',
      dateOfBirthDisplay: formatDate(dob),
      genderLabel: GENDER_LABELS[safeStr(r.gender).toLowerCase()] || safeStr(r.gender) || '—',
      occupationLabel: OCCUPATION_LABELS[safeStr(r.occupation).toLowerCase()] || safeStr(r.occupation) || '—',
      age: age ?? '—',
      ageBand: band || '—',
      excessDisplay: bandRow ? formatExcess(bandRow.excess) : '—',
      premiumGrossDisplay: bandRow ? `€${moneyDisplayFixed(bandRow.premiumGross)}` : '—',
    };
  });

  const proposerName = [safeStr(proposer.firstName), safeStr(proposer.lastName)].filter(Boolean).join(' ').trim()
    || safeStr(policy.policyHolder?.name)
    || 'Insured';

  const currency = String(snapshotResp.currency || 'EUR').toUpperCase();
  const symbol = CURRENCY_SYMBOLS[currency] || '€';

  // Use breakdown.lines if available (canonical), else fall back to
  // top-level premium fields. Mirrors the travel approach where
  // schedule renders identical numbers to wizard sidebar + BO premium.
  const lines = Array.isArray(breakdown.lines) ? breakdown.lines as Array<UnknownRecord> : [];
  const premiumLines = lines.map((line) => ({
    code: safeStr(line.code),
    label: safeStr(line.code) === 'total' ? 'Total' : safeStr(line.label),
    amountDisplay: `${symbol}${moneyDisplayFixed(line.amount)}`,
    kind: safeStr(line.kind),
  }));

  const annualPremium = Number(policyResp.annualPremium ?? breakdown.grossPremium ?? 0);

  return {
    // Page 1 — Lloyd's jacket
    lloydsJacketTitle: DEFAULT_LLOYDS_JACKET_TITLE,
    lloydsJacketSignDate: formatDate(issueDate),
    lloydsJacketAddress: 'Bastion Tower, Marsveldplein 5, 1050 Brussels, Belgium',
    lloydsJacketRegistrationNumber: '682.594.839 RLE (Brussels)',
    lloydsJacketWebsite: 'www.lloydseurope.com',
    lloydsJacketEmail: 'enquiries.lloydseurope@lloyds.com',
    lloydsJacketBank: 'Citibank Europe plc Belgium Branch, Boulevard General Jacques 263G, Brussels 1050, Belgium - BE46570135225536',
    lloydsJacketRegulator: 'National Bank of Belgium',
    lloydsJacketWebsiteRegulator: 'www.nbb.be',
    lloydsJacketReference: 'LBS0004J (01/01/2019) - Lloyd\'s Insurance Company S.A. Generic Policy Jacket',

    // Coverholder block (shared across pages 2-3)
    coverholderName: DEFAULT_COVERHOLDER_NAME,
    coverholderAddress: DEFAULT_COVERHOLDER_ADDRESS,
    coverholderTelephone: DEFAULT_COVERHOLDER_TEL,
    coverholderFax: DEFAULT_COVERHOLDER_FAX,
    coverholderUmr: safeStr(policy.umr || policy.binderUmr),
    coverholderAgreementUmrLine: `Coverholder Appointment Agreement Unique Market Reference (UMR) ${safeStr(policy.umr || policy.binderUmr)}`,
    policyVersionNo: DEFAULT_POLICY_VERSION,

    // Policy identity
    policyNumber: safeStr(policy.policyNumber || policy.id),
    certificateNumber: safeStr(policy.certificateNumber || policy.policyNumber || policy.id),
    issueDateDisplay: formatDate(issueDate),
    inceptionDateDisplay: formatDate(inception),
    expiryDateDisplay: formatDate(expiry),

    // Proposer
    proposerName,
    proposerIdentityNumber: safeStr(proposer.idNumber) || '—',
    proposerMailingAddress: formatAddress(proposerAddress),
    proposerMailingAddressMultiline: formatAddressMultiline(proposerAddress),
    proposerTelephone: safeStr(proposer.phone) || '—',
    proposerEmail: safeStr(proposer.email) || '—',
    proposerOccupationLabel: OCCUPATION_LABELS[safeStr(proposer.occupation).toLowerCase()] || safeStr(proposer.occupation) || 'Other',
    proposerDateOfBirthDisplay: formatDate(safeStr(proposer.dateOfBirth)),
    proposerGenderLabel: GENDER_LABELS[safeStr(proposer.gender).toLowerCase()] || safeStr(proposer.gender) || '—',

    // Cover summary
    coverTypeLabel,
    coverTypeRaw,
    sectionsApplicable: 'SECTION A - INBOUND INDIVIDUAL MEDICAL INSURANCE',
    countryOfCover: 'The Republic of Cyprus only',

    // Insured persons table
    insuredPersons,
    insuredCount: insuredPersons.length,
    isSingleInsured: insuredPersons.length === 1,

    // Base cover (Section A)
    baseCover: {
      inpatientPerIllnessDisplay: `€${moneyDisplayInt(baseCover.inpatientPerIllness)}`,
      inpatientPerPeriodDisplay: `€${moneyDisplayInt(baseCover.inpatientPerPeriod)}`,
      dailyRoomRegularDisplay: `€${moneyDisplayInt(baseCover.dailyRoomRegular)}`,
      dailyRoomEmergencyDisplay: `€${moneyDisplayInt(baseCover.dailyRoomEmergency)}`,
      childbirthLumpSumDisplay: `€${moneyDisplayInt(baseCover.childbirthLumpSum)}`,
      repatriationLimitDisplay: `€${moneyDisplayInt(baseCover.repatriationLimit)}`,
    },

    // GHS extension (rendered only when isGhsBeneficiary)
    isGhsBeneficiary,
    ghsExtension: {
      outpatientPerIllnessDisplay: `€${moneyDisplayInt(ghsExtension.outpatientPerIllness)}`,
      outpatientPerPeriodDisplay: `€${moneyDisplayInt(ghsExtension.outpatientPerPeriod)}`,
      doctorVisitDisplay: `€${moneyDisplayInt(ghsExtension.doctorVisit)}`,
      doctorVisitsPerPeriodDisplay: `€${moneyDisplayInt(ghsExtension.doctorVisitsPerPeriod)}`,
      medicationsDisplay: `€${moneyDisplayInt(ghsExtension.medications)}`,
      outpatientExcessDisplay: `€${moneyDisplayInt(ghsExtension.outpatientExcess)}`,
      coinsurancePercentDisplay: `${ghsExtension.coinsurancePercent}%`,
      deathByAccidentDisplay: `€${moneyDisplayInt(ghsExtension.deathByAccidentLimit)}`,
      repatriationAfterDeathDisplay: `€${moneyDisplayInt(ghsExtension.repatriationAfterDeathLimit)}`,
    },

    // Premium
    currency,
    currencySymbol: symbol,
    totalPremiumDisplay: `${moneyDisplayFixed(annualPremium)} EUROS (inclusive of Policy Fees)`,
    annualPremiumDisplay: `${symbol}${moneyDisplayFixed(annualPremium)}`,
    premiumLines,
    paymentTerms: 'Annual premium for an annual policy term, payable in full at inception',
    specialProvisions: 'ENDORSEMENTS',
    sanctionsClause: {
      headingLine: CV1020_HEADING_LINE,
      text: CV1020_SANCTIONS_CLAUSE.text,
    },
    // Endorsement No. 141 — printed only when isGhsBeneficiary (the
    // schedule template guards the row). Wording sourced from the MBE
    // catalog const so document and catalog cannot drift.
    gesyClaimsCondition: {
      headingLine: GESY_CLAIMS_CONDITION.headingLine,
      intro: GESY_CLAIMS_CONDITION.intro,
      clauses: [...GESY_CLAIMS_CONDITION.clauses],
      closing: GESY_CLAIMS_CONDITION.closing,
    },

    // Jurisdiction
    tenantCountryName: jurisdictionConfig.countryName,
    taxProfile: jurisdictionConfig.taxRegime.profileCode,
  };
}
