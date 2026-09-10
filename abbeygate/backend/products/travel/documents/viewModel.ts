import type { DocPackContext } from '../../shared/documents/genericDocPackGenerator.js';
import { contactEmailForCountry, contactPhoneForCountry, getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { getTravelAddonLabel, travelDestinationAreaLabel } from '@facio/products';
import {
  getTravelLegalContacts,
  resolveJurisdictionProductConfig,
} from '../../../modules/jurisdiction/domain/productConfiguration.js';
import { CV1020_SANCTIONS_CLAUSE, CV1020_HEADING_LINE } from '../../shared/documents/sanctionsClause.js';

type UnknownRecord = Record<string, unknown>;

const PLAN_LABELS: Record<string, string> = {
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

const COVER_TYPE_LABELS: Record<string, string> = {
  single: 'Single Traveller',
  couple: 'Couple',
  family: 'Family',
  single_parent_family: 'Single Parent Family',
};

const TRIP_TYPE_LABELS: Record<string, string> = {
  single_trip: 'Single Trip',
  annual_multi_trip: 'Multi Trip',
};

// ABY-264 — addon labels are read from the canonical
// `@facio/products` catalogue (`getTravelAddonLabel`). Mirror tables
// here used to drift the day a new addon was added; never re-introduce
// a parallel `ADDON_LABELS` map in this file.

const CURRENCY_WORDS: Record<string, string> = {
  EUR: 'Euro',
  GBP: 'Pounds',
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€',
  GBP: '£',
  USD: '$',
};

// Default Brit/Abbeygate Travel binding-authority static data (legacy
// schedule parity for the Cyprus tenant). Values that vary by binder
// (complaints email, claim TSP) are pinned to the legacy artefact until
// supplied via binder metadata. The UMR is NOT one of them: it is the
// bound binder's Unique Market Reference (`policy.umr` / `policy.binderUmr`)
// and must never be hard-coded here.
const DEFAULT_POLICY_WORDING_REFERENCE = 'ABBEYGATE TRAVEL POLICY B1';
const DEFAULT_CLAIM_PROVIDER = 'CEGA GROUP SERVICES';
const DEFAULT_CLAIM_EMAIL = 'claims@cegagroup.com';
const DEFAULT_CLAIM_TELEPHONE = '+44 (0) 1243 219634';
const DEFAULT_CLAIM_ADDRESS = 'PO Box 127, Chichester, West Sussex, PO18 8WQ';
const DEFAULT_MEDICAL_HELP_TELEPHONE = '00353 915 60663';
const DEFAULT_COMPLAINTS_EMAIL = 'BGS.Complaints@Britinsurance.com';

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function safeStr(value: unknown): string {
  return String(value ?? '').trim();
}

function num2(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

function moneyDisplayFixed(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(input: unknown): string {
  if (input == null || input === '') return '—';
  const d = input instanceof Date ? input : new Date(String(input));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateNumeric(input: unknown): string {
  if (input == null || input === '') return '—';
  const d = input instanceof Date ? input : new Date(String(input));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function parseHolderContact(contactRaw: unknown): { email?: string; phone?: string } {
  const raw = safeStr(contactRaw);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as UnknownRecord;
    const primary = asRecord(parsed.primary);
    return {
      email: safeStr(parsed.email || primary.email) || undefined,
      phone: safeStr(parsed.phone || primary.phone) || undefined,
    };
  } catch {
    if (raw.includes('@')) return { email: raw };
    return {};
  }
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

function yesNo(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') return 'Yes';
  if (s === 'false' || s === 'no' || s === '0' || s === '') return 'No';
  return String(value);
}

function namedPerson(firstName: unknown, lastName: unknown, fallback: string): string {
  const name = [safeStr(firstName), safeStr(lastName)].filter(Boolean).join(' ').trim();
  return name || fallback;
}

function inclusiveDays(startRaw: unknown, endRaw: unknown): number | null {
  const start = new Date(String(startRaw || ''));
  const end = new Date(String(endRaw || ''));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(1, Math.floor((Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) / 86_400_000) + 1);
}

function destinationsToAreaLabel(destinations: string[]): string {
  if (destinations.length === 0) return 'Per area selected';
  if (destinations.length === 1) return destinations[0];
  // If "worldwide" anything is selected, use that as the headline area.
  const worldwide = destinations.find((d) => /worldwide/i.test(d));
  if (worldwide) return worldwide;
  return destinations.join(', ');
}

/**
 * Resolve country-of-residence-specific Service of Suit + complaints
 * for the schedule template. Per ADR-0024, the customer's declared
 * `eligibility.countryOfResidence` overrides the tenant for Travel —
 * a CY-tenant policy issued for an Italian resident must render the
 * Italian (or, until BRIT supplies it, fail loud) Service of Suit
 * block, never the Cyprus block.
 *
 * Throws `MissingTravelLegalContactsError` (via `getTravelLegalContacts`)
 * for BRIT-authorised countries that don't yet have wording — issuance
 * is blocked, the customer-facing error surfaces as REFER.
 */
function buildLegalContacts(countryOfResidence: string): Record<string, unknown> {
  const config = resolveJurisdictionProductConfig({
    productCode: 'TRAVEL',
    customerCountryOfResidence: countryOfResidence,
  });
  const legal = getTravelLegalContacts(config);
  // Convenience flatten of recipient-1 fields so the template's
  // `{{legalContacts.generalRepresentative}}` etc. placeholders keep
  // working without a structural change. Cyprus carries a full
  // generalRepresentative block; PT/ES carry only the recipient.
  const primaryRecipient = legal.serviceOfSuit.recipients[0];
  return {
    governingLaw: legal.governingLaw,
    jurisdiction: legal.jurisdiction,
    // Service of Suit recipients (full structured list for template
    // rendering of multi-recipient countries like Cyprus).
    serviceOfSuitRecipients: legal.serviceOfSuit.recipients.map((r) => ({
      name: r.name,
      addressDisplay: r.addressLines.join(', '),
      addressLines: r.addressLines,
    })),
    serviceOfSuitReference: `${legal.serviceOfSuit.referenceCode} — ${legal.serviceOfSuit.referenceDate}`,
    // Backwards-compatible flat fields for the existing schedule.html
    // placeholders ({{legalContacts.generalRepresentative}} etc.).
    generalRepresentative: legal.generalRepresentative?.name ?? primaryRecipient?.name ?? '',
    generalRepresentativeFor: legal.generalRepresentative?.representativeFor ?? legal.jurisdiction,
    generalRepresentativeAddress: (legal.generalRepresentative?.addressLines ?? primaryRecipient?.addressLines ?? []).join(', '),
    lloydsLocalEntityName: legal.lloydsLocalEntity?.name ?? '',
    lloydsLocalEntityAddress: (legal.lloydsLocalEntity?.addressLines ?? []).join(', '),
    // Complaints / ombudsman (verbatim from the BRIT TRAVEL DRAFT
    // SCHEDULE V3 docx).
    complaintsReference: `${legal.complaints.referenceCode} — ${legal.complaints.referenceDate}`,
    complaintsProcedureParagraphs: legal.complaints.procedureParagraphs,
    ombudsmanName: legal.complaints.ombudsmanName,
    ombudsmanPostal: legal.complaints.ombudsmanPostal,
    ombudsmanTel: legal.complaints.ombudsmanTel ?? '',
    ombudsmanFax: legal.complaints.ombudsmanFax ?? '',
    ombudsmanEmail: legal.complaints.ombudsmanEmail ?? '',
    ombudsmanWebsite: legal.complaints.ombudsmanWebsite ?? '',
    authorityName: legal.complaints.authorityName ?? '',
    authorityPostal: legal.complaints.authorityPostal ?? '',
    authorityTel: legal.complaints.authorityTel ?? '',
    authorityFax: legal.complaints.authorityFax ?? '',
    authorityWebsite: legal.complaints.authorityWebsite ?? '',
    // Legacy claims contact (universal across countries — CEGA Group).
    claimProvider: DEFAULT_CLAIM_PROVIDER,
    claimEmail: DEFAULT_CLAIM_EMAIL,
    claimTelephone: DEFAULT_CLAIM_TELEPHONE,
    claimAddress: DEFAULT_CLAIM_ADDRESS,
    complaintsEmail: DEFAULT_COMPLAINTS_EMAIL,
    medicalHelpTelephone: DEFAULT_MEDICAL_HELP_TELEPHONE,
    odrPlatform: 'www.ec.europa.eu/odr',
  };
}

/**
 * Build the Travel doc-pack view-model from the canonical
 * `quoteData` + `quoteResponse` snapshot. Pure: no DB calls, no
 * cross-product imports — easy to test.
 *
 * Mirrors the legacy Abbeygate Your Travel schedule structure:
 *   - Lloyd's Insurance Company S.A. policy jacket (page 1)
 *   - Coverholder letter + schedule + insured persons + emergency
 *     contact (pages 2–3)
 *   - Coverholder / general representative / cover summary (page 4)
 *   - Wording, governing law / jurisdiction / service of suit /
 *     claim notification (page 5)
 *   - Complaints handling notice (page 6)
 */
export function buildTravelDocViewModel(ctx: DocPackContext): UnknownRecord {
  const policy = ctx.policy;
  const qd = ctx.quoteData;
  const snapshotResp = asRecord(ctx.snapshot.quoteResponse);
  const policyResp = asRecord(snapshotResp.primaryOption);
  const breakdown = asRecord(policyResp.breakdown);

  const eligibility = asRecord(qd.eligibility);
  const travellers = asRecord(qd.travellers);
  const trip = asRecord(qd.trip);
  const quote = asRecord(qd.quote);
  const proposer = asRecord(qd.proposer);
  const addons = asRecord(qd.addons);
  const declarations = asRecord(qd.declarations);

  const selectedPlan = String(quote.selectedPlan || 'silver').toLowerCase();
  const planLabel = PLAN_LABELS[selectedPlan] || PLAN_LABELS.silver;

  const coverTypeRaw = String(travellers.coverType || 'single').toLowerCase();
  const coverTypeLabel = COVER_TYPE_LABELS[coverTypeRaw] || coverTypeRaw;

  const tripTypeRaw = String(trip.planType || 'single_trip').toLowerCase();
  const tripTypeLabel = TRIP_TYPE_LABELS[tripTypeRaw] || tripTypeRaw;

  const destinationsRaw: string[] = Array.isArray(trip.destinations)
    ? (trip.destinations as unknown[]).map((d) => safeStr(d)).filter(Boolean)
    : [];
  const destinations = destinationsRaw.map((destination) => travelDestinationAreaLabel(destination) || destination);
  const tripDays = inclusiveDays(trip.startDate, trip.endDate);
  const maxTripDays = Number(quote.maxTripDays);

  const addonsLabels = Object.entries(addons)
    .filter(([, on]) => Boolean(on))
    .map(([key]) => getTravelAddonLabel(key) || key);

  const tenantConfig = getTenantConfig();

  const currency = String(snapshotResp.currency || 'EUR').toUpperCase();
  const symbol = CURRENCY_SYMBOLS[currency] || '';

  const contact = parseHolderContact(policy.policyHolder?.contact);

  const proposerName = [proposer.firstName, proposer.lastName].filter(Boolean).join(' ');
  const holderName = safeStr(
    proposerName ||
      policy.policyHolder?.name ||
      'Insured',
  );
  const holderEmail = safeStr(proposer.email || contact.email || '');
  const holderPhone = safeStr(proposer.phone || contact.phone || '');

  const addressMultiline = formatAddressMultiline(asRecord(proposer.address));

  const isMultiTrip = tripTypeRaw === 'annual_multi_trip';
  const maxTripDurationDays = isMultiTrip
    ? (Number.isFinite(maxTripDays) && maxTripDays > 0 ? maxTripDays : 31)
    : (tripDays || 0);
  const maxTripDurationDisplay = `${maxTripDurationDays} Days`;

  // Per legacy schedule (Brit/Abbeygate Travel binding authority):
  // - the schedule "Insured Persons" table shows the Yes/No screening
  //   answer in the `preExistingMedicalLabel` column, AND
  // - the insurance-cover table on the next page declares the same line as
  //   "Excluded" — preserved here as `preExistingMedical` for parity with
  //   the legacy artefact and existing contract tests.
  const additionalTravellerDOBs = Array.isArray(travellers.additionalTravellerDOBs)
    ? (travellers.additionalTravellerDOBs as unknown[]).map((value) => safeStr(value))
    : [];
  const additionalTravellerDetails = Array.isArray(travellers.additionalTravellers)
    ? travellers.additionalTravellers as unknown[]
    : [];
  const derivedInsuredPersons = [
    {
      name: holderName,
      dateOfBirthDisplay: formatDateNumeric(safeStr(travellers.leadTravellerDOB || proposer.dateOfBirth)),
      medicalScreeningRef: 'N/A',
      preExistingMedicalLabel: 'No',
      preExistingMedical: 'Excluded',
      excludedLabel: 'Excluded',
    },
    ...additionalTravellerDOBs.map((dob, index) => {
      const details = asRecord(additionalTravellerDetails[index]);
      return {
        name: namedPerson(details.firstName, details.lastName, `Traveller ${index + 2}`),
        dateOfBirthDisplay: formatDateNumeric(dob || details.dateOfBirth),
        medicalScreeningRef: safeStr(details.medicalScreeningRef || 'N/A'),
        preExistingMedicalLabel: yesNo(details.preExistingMedical),
        preExistingMedical: safeStr(details.preExistingMedical || 'Excluded'),
        excludedLabel: 'Excluded',
      };
    }),
  ];

  const insuredPersons = Array.isArray(travellers.insuredPersons) && travellers.insuredPersons.length > 0
    ? (travellers.insuredPersons as unknown[]).map((item) => {
        const person = asRecord(item);
        return {
          name: safeStr(person.name || [person.firstName, person.lastName].filter(Boolean).join(' ')) || holderName,
          dateOfBirthDisplay: formatDateNumeric(person.dateOfBirth || person.dob),
          medicalScreeningRef: safeStr(person.medicalScreeningRef || 'N/A'),
          preExistingMedicalLabel: yesNo(person.preExistingMedical),
          preExistingMedical: safeStr(person.preExistingMedical || 'Excluded'),
          excludedLabel: 'Excluded',
        };
      })
    : derivedInsuredPersons;

  const netPremium = Number(breakdown.netPremium ?? policyResp.netPremium ?? 0);
  const iptAmount = Number(breakdown.iptAmount ?? policyResp.iptAmount ?? 0);
  const adminFee = Number(breakdown.adminFee ?? policyResp.adminFee ?? 0);
  const grossPremium = Number(breakdown.grossPremium ?? policyResp.annualPremium ?? netPremium + iptAmount + adminFee);

  // ABY-264 — Pass through the canonical breakdown lines so the
  // schedule template can render the same base → addons → tax → admin
  // fee → total breakdown the wizard sidebar and BO Premium tab show.
  // Single source: the calculator's `TravelBreakdown.lines`.
  const rawLines = Array.isArray(breakdown.lines) ? (breakdown.lines as unknown[]) : [];
  // Zero-amount rows are noise and are dropped; NEGATIVE rows are real —
  // the ADR-0056 BDX declared-premium alignment emits a `discount` line, and
  // hiding it would leave the detail rows summing above the total.
  const breakdownLines = rawLines
    .map((entry) => asRecord(entry))
    .filter((entry) => {
      const amount = Number(entry.amount);
      return (Number.isFinite(amount) && amount !== 0) || String(entry.code || '') === 'total';
    })
    .map((entry) => ({
      code: String(entry.code || ''),
      label: String(entry.label || ''),
      amountDisplay: moneyDisplayFixed(entry.amount),
      kind: String(entry.kind || ''),
    }));

  const issueDate = new Date();
  const policyNumber = safeStr(policy.policyNumber || policy.id);
  const umrValue = safeStr(policy.umr || policy.binderUmr);

  return {
    // ─── Document identifiers ────────────────────────────────────────────
    policyNumber,
    certificateNumber: safeStr(policy.certificateNumber || ''),
    umr: umrValue,
    coverholderUmr: umrValue,
    policyWordingReference: DEFAULT_POLICY_WORDING_REFERENCE,
    sanctionsClause: {
      headingLine: CV1020_HEADING_LINE,
      text: CV1020_SANCTIONS_CLAUSE.text,
    },
    tenant: {
      countryName: tenantConfig.country,
      countryCode: tenantConfig.countryCode,
    },

    // ─── Lloyd's cover page ─────────────────────────────────────────────
    generatedDate: formatDateNumeric(issueDate),
    issueDateDisplay: formatDateNumeric(issueDate),
    lloydsRegistration: '682.594.839',
    lloydsBankDetails: 'Citibank Europe plc Belgium Branch, Boulevard General Jacques 263G, Brussels 1050, Belgium - BE46570135225536.',
    lloydsWebsite: 'www.lloydseurope.com',
    lloydsEmail: 'enquiries.lloydseurope@lloyds.com',

    // ─── Insured / proposer ─────────────────────────────────────────────
    policyHolder: {
      name: holderName,
      email: holderEmail,
      phone: holderPhone,
      addressDisplay: formatAddress(asRecord(proposer.address)) || '—',
      addressMultiline: addressMultiline || '—',
      dateOfBirthDisplay: formatDate(proposer.dateOfBirth),
      idType: safeStr(proposer.idType || '—'),
      idNumber: safeStr(proposer.idNumber || '—'),
    },
    eligibility: {
      countryOfResidence: safeStr(eligibility.countryOfResidence || tenantConfig.country),
      isExpatLabel: yesNo(eligibility.isExpat),
      legalAgreementLabel: yesNo(eligibility.legalAgreement),
    },
    travellers: {
      leadTravellerDOB: formatDate(safeStr(travellers.leadTravellerDOB)),
      insuredPersons,
    },
    period: {
      startDisplay: formatDate(trip.startDate || policy.inceptionDate),
      endDisplay: formatDate(trip.endDate || policy.expiryDate),
      startNumeric: formatDateNumeric(trip.startDate || policy.inceptionDate),
      endNumeric: formatDateNumeric(trip.endDate || policy.expiryDate),
    },
    planLabel,
    levelOfCoverLabel: planLabel,
    tripTypeLabel,
    policyTypeLabel: `Policy Type Of Cover - ${tripTypeLabel}`,
    coverTypeLabel,
    tripDaysDisplay: tripDays ? `${tripDays} days` : '—',
    maxTripDurationDays,
    maxTripDurationDisplay,
    destinations,
    destinationsDisplay: destinations.length > 0 ? destinations.join(', ') : 'Per area selected',
    areaOfTravelLabel: destinationsToAreaLabel(destinations),
    medicalNotice: 'Any pre-existing medical conditions are excluded unless accepted in writing by the insurer or medical screening provider.',
    declarations: {
      medicalNoticeLabel: yesNo(declarations.medicalNotice),
      howToClaimReviewLabel: yesNo(declarations.howToClaimReview),
      personalDataConsentLabel: yesNo(declarations.personalDataConsent),
      contractConsentLabel: yesNo(declarations.contractConsent),
      contractAgreementLabel: yesNo(declarations.contractAgreement),
    },
    addonsLabels,
    optionalExtensionsDisplay: addonsLabels.length > 0 ? addonsLabels.join(', ') : 'None',
    currency,
    currencyWord: CURRENCY_WORDS[currency] || currency,
    currencySymbol: symbol,
    premium: {
      net: num2(netPremium),
      ipt: num2(iptAmount),
      adminFee: num2(adminFee),
      gross: num2(grossPremium),
    },
    premiumSummary: {
      premiumDisplay: moneyDisplayFixed(netPremium),
      adminFeeDisplay: moneyDisplayFixed(adminFee),
      taxFeeDisplay: moneyDisplayFixed(iptAmount),
      totalPremiumDisplay: moneyDisplayFixed(grossPremium),
      /**
       * Canonical ordered breakdown — base → addons (catalogue order) →
       * tax → admin fee → total. Provided to the schedule template so
       * a future template update can render the same shape the wizard
       * and BO Premium tab show, without re-deriving labels.
       */
      lines: breakdownLines,
    },
    legalContacts: buildLegalContacts(safeStr(eligibility.countryOfResidence)),
    coverholder: {
      legalName: 'ABBEYGATE INSURANCE SERVICES LIMITED',
      addressOneLine: 'SHOP 1, Mesogi Avenue, Pahpos, 8280, Cyprus.',
      contactEmail: contactEmailForCountry(tenantConfig.countryCode),
      contactPhone: contactPhoneForCountry(tenantConfig.countryCode),
    },
  };
}
