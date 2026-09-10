import type { DocPackContext } from '../../shared/documents/genericDocPackGenerator.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import {
  hasSpecifiedHighRiskItems,
  resolveHomeSolarPanelCoverAmount,
  wasHomeSolarPanelMinimumRated,
} from '@facio/products';
import { resolveHomePolicyWording, resolveHomeWordingDomicile } from './policyWording.js';
import { CV1020_SANCTIONS_CLAUSE } from '../../shared/documents/sanctionsClause.js';
import {
  HOME_HOLIDAY_UNOCCUPIED_INSPECTION_ENDORSEMENT,
  requiresHolidayHomeInspectionEndorsement,
} from '../policyTerms.js';

type UnknownRecord = Record<string, unknown>;

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€',
  GBP: '£',
  USD: '$',
};

const ADDON_LABELS: Record<string, string> = {
  accidentalDamageBuildings: 'Accidental Damage — Buildings',
  accidentalDamageContents: 'Accidental Damage — Contents',
  allRiskJewellery: 'High Risk Items',
  allRiskOther: 'All Risks Unspecified',
  solarPanels: 'Solar Panels',
  europAssistance: 'Europ Assistance Helpline',
};

const EXCESS_LABEL: Record<string, string> = {
  'STD 150 XS': '150',
  '350 XS': '350',
  '750 XS': '750',
};

// Defaults from legacy Abbeygate Home Insurance schedule (LBS0004J jacket).
// Excess values for buildings (escape of water, earthquake, subsidence) are
// fixed by the binder authority – not customer-facing dynamic config.
const DEFAULT_BUILDINGS_EXCESS_NOTE =
  'Euro 150.00 excess, or Euro 375 for Escape of Water damage, or Euro 1500 or 2% of the total insured value (TIV) whichever is the greater for earthquake and/or volcanic eruption. Subsidence, Heave, Landslip (where included) excess 4500 Euro.';

const DEFAULT_CONTENTS_OUTBUILDINGS_LIMIT = 3000;
const DEFAULT_CONTENTS_OUTBUILDINGS_SINGLE_ARTICLE = 300;
const DEFAULT_SINGLE_ARTICLE_JEWELLERY_LIMIT = 1500;
// Lloyd's coverholder Home wording caps each high-value contents item at
// 20% of the contents sum insured (legacy Abbeygate calculator behaviour).
const TOTAL_JEWELLERY_PCT_OF_CONTENTS = 0.2;
const DEFAULT_LIABILITY_INDEMNITY = 1_000_000;

// Territories whose Home binder does NOT offer subsidence/heave/landslip
// cover. Every schedule issued there carries the AB99 Deletion of Cover
// endorsement (data-driven per the jurisdiction-product-config contract —
// extend this set, don't add country branches at call sites).
const SUBSIDENCE_COVER_DELETED_TERRITORIES: ReadonlySet<string> = new Set(['PT']);
const DEFAULT_EMERGENCY_TRAVEL_PER_RETURN_TICKET = 350;
const DEFAULT_EMERGENCY_TRAVEL_TEMP_ACCOM = 600;
const DEFAULT_EMERGENCY_TRAVEL_TOTAL = 1500;

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

function moneyDisplay(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n.toLocaleString('en-IE');
}

function moneyDisplayFixed(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(input: Date | string | null | undefined): string {
  if (!input) return '—';
  const d = input instanceof Date ? input : new Date(String(input));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateNumeric(input: Date | string | null | undefined): string {
  if (!input) return '—';
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

function yesNo(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') return 'Yes';
  if (s === 'false' || s === 'no' || s === '0' || s === '') return 'No';
  return String(value);
}

function selectedCoverageCode(snapshot: UnknownRecord, code: string): boolean | null {
  const coverageSelection = asRecord(snapshot.coverageSelection);
  const selected = asRecord(coverageSelection.selected);
  if (!Object.prototype.hasOwnProperty.call(selected, code)) return null;
  return selected[code] === true;
}

function formatAddress(address: UnknownRecord): string {
  const parts = [
    safeStr(address.line1),
    safeStr(address.line2),
    [safeStr(address.city), safeStr(address.postcode)].filter(Boolean).join(' '),
    safeStr(address.country),
  ].filter(Boolean);
  return parts.join(', ');
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

function formatPersonAddress(value: unknown): string {
  return formatAddress(asRecord(value));
}

function policyHolderName(holder: UnknownRecord): string {
  return [safeStr(holder.firstName), safeStr(holder.lastName)].filter(Boolean).join(' ').trim();
}

function jointProposerRows(value: unknown): UnknownRecord[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((row) => asRecord(row)).map((holder, index) => {
    const name = policyHolderName(holder) || `Joint proposer ${index + 1}`;
    return {
      name,
      firstName: safeStr(holder.firstName) || '—',
      surname: safeStr(holder.lastName) || '—',
      email: safeStr(holder.email) || '—',
      phone: safeStr(holder.phone) || '—',
      dateOfBirthDisplay: formatDate(safeStr(holder.dateOfBirth)),
      nationality: safeStr(holder.nationality || '—'),
      domicileCountry: safeStr(holder.domicileCountry || '—'),
      addressDisplay: formatPersonAddress(holder.address) || '—',
      addressMultiline: formatAddressMultiline(asRecord(holder.address)) || '—',
      occupation: safeStr(holder.occupation || '—'),
      nif: safeStr(holder.nif || '—'),
    };
  });
}

function unoccupancyLabel(value: unknown): string {
  const s = safeStr(value).toLowerCase();
  if (!s) return 'Up to 30 Days';
  // Accept "30", "30 days", "60 days", "permanent", etc.
  if (s.includes('permanent')) return 'Permanent (no unoccupancy)';
  const days = Number(s.replace(/[^0-9]/g, ''));
  if (Number.isFinite(days) && days > 0) return `Up to ${days} Days`;
  return safeStr(value);
}

function propertyUseLabel(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  return yesNo(value) === 'Yes' ? 'For a Permanent Home' : 'For a Holiday Home';
}

/**
 * Build the Home doc-pack view-model from the canonical
 * `quoteData` + `quoteResponse` snapshot. Pure: no DB calls.
 *
 * Structure mirrors the legacy Abbeygate Home schedule:
 *   - Lloyd's Insurance Company S.A. policy jacket (page 1)
 *   - Schedule with sections A (Buildings), B (Contents),
 *     C (Valuables), D (Solar Panels), E (Liability),
 *     F (Emergency Travel) and a premium summary (page 2)
 *   - Maintenance & Checking Conditions (page 3)
 *   - Service of Suit / Coverholder / Claim notification /
 *     Complaint handling (page 4)
 *   - Endorsements (AB1 + AB14) and specified items (page 5)
 */
export function buildHomeDocViewModel(ctx: DocPackContext): UnknownRecord {
  const policy = ctx.policy;
  const qd = ctx.quoteData;
  const snapshot = asRecord(ctx.snapshot);
  const snapshotResp = asRecord(ctx.snapshot.quoteResponse);
  const policyResp = asRecord(snapshotResp.primaryOption);
  const breakdown = asRecord(policyResp.breakdown);

  const property = asRecord(qd.property);
  const propertyAddress = asRecord(property.address);
  const policyholderAddress = asRecord(asRecord(qd.proposer).address);
  const coverage = asRecord(qd.coverage);
  const risk = asRecord(qd.risk);
  const policyPeriod = asRecord(qd.policy);
  const proposer = asRecord(qd.proposer);
  const usage = asRecord(qd.usage);
  const security = asRecord(qd.security);
  const eligibility = asRecord(qd.eligibility);
  const mortgage = asRecord(qd.mortgage);

  const tenantConfig = getTenantConfig();
  // ADR-0048 — the wording reference printed on the schedule must match
  // the wording PDF attached to the pack (tenant territory × domicile).
  const policyWordingReference = resolveHomePolicyWording(
    tenantConfig.countryCode,
    resolveHomeWordingDomicile(qd),
  ).reference;

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
  const jointProposers = jointProposerRows(qd.policyHolders);
  const jointProposer = jointProposers[0] || {
    name: '—',
    firstName: '—',
    surname: '—',
    email: '—',
    phone: '—',
    dateOfBirthDisplay: '—',
    nationality: '—',
    domicileCountry: '—',
    addressDisplay: '—',
    addressMultiline: '—',
    occupation: '—',
    nif: '—',
  };

  // Split first/surname for the Statement-of-Fact form which expects two
  // distinct cells. Prefer the canonical proposer fields; fall back to a
  // best-effort split of the policy holder display name.
  const proposerFirstName = safeStr(proposer.firstName || '');
  const proposerLastName = safeStr(proposer.lastName || '');
  const fallbackNameParts = holderName.split(/\s+/).filter(Boolean);
  const firstNameDisplay = proposerFirstName || (fallbackNameParts.length > 1 ? fallbackNameParts.slice(0, -1).join(' ') : fallbackNameParts[0] || '—');
  const surnameDisplay = proposerLastName || (fallbackNameParts.length > 1 ? fallbackNameParts[fallbackNameParts.length - 1] : '—');

  const riskAddress = property.sameAsProposer === true ? policyholderAddress : propertyAddress;
  const propertyAddressDisplay = formatAddress(riskAddress);
  const propertyAddressMultiline = formatAddressMultiline(riskAddress);
  const correspondenceAddressMultiline = formatAddressMultiline(policyholderAddress);

  const adBuildingsSelected = coverage.accidentalDamageBuildings === true;
  const adContentsSelected = coverage.accidentalDamageContents === true;
  const europAssistanceSelected =
    selectedCoverageCode(snapshot, 'HOME-EUROP-ASSISTANCE') ??
    (qd.europAssistance === true || asRecord(qd.europAssistance).selected === true);

  const rawSolarPanels = Number(coverage.solarPanels || coverage.solarPanelCover || 0);
  const solarPanels = wasHomeSolarPanelMinimumRated(asRecord(policyResp.calculationTrace).calculatorVersion)
    ? resolveHomeSolarPanelCoverAmount(tenantConfig.countryCode, rawSolarPanels)
    : rawSolarPanels;

  const addonsLabels: string[] = [];
  if (adBuildingsSelected) addonsLabels.push(ADDON_LABELS.accidentalDamageBuildings);
  if (adContentsSelected) addonsLabels.push(ADDON_LABELS.accidentalDamageContents);
  if (Number(coverage.allRiskJewellery) > 0) addonsLabels.push(ADDON_LABELS.allRiskJewellery);
  if (Number(coverage.allRiskOther) > 0) addonsLabels.push(ADDON_LABELS.allRiskOther);
  if (solarPanels > 0) addonsLabels.push(ADDON_LABELS.solarPanels);
  if (europAssistanceSelected) addonsLabels.push(ADDON_LABELS.europAssistance);

  const selectedStartDate = policyPeriod.startDate ? new Date(String(policyPeriod.startDate)) : null;
  const inceptionDate = selectedStartDate && !Number.isNaN(selectedStartDate.getTime())
    ? selectedStartDate
    : policy.inceptionDate || null;
  const expiryDate = inceptionDate ? new Date(new Date(inceptionDate).setFullYear(new Date(inceptionDate).getFullYear() + 1)) : policy.expiryDate;
  const issueDate = new Date();

  const allRiskJewellery = Number(coverage.allRiskJewellery || 0);
  const allRiskOther = Number(coverage.allRiskOther || 0);
  const buildings = Number(coverage.buildings || coverage.buildingsSumInsured || 0);
  const contents = Number(coverage.contents || coverage.contentsSumInsured || 0);

  // Per legacy schedule — total jewellery limit is capped at 20% of contents.
  const maxTotalJewelleryLimit = Math.round(contents * TOTAL_JEWELLERY_PCT_OF_CONTENTS);

  const excessRaw = String(risk.increasedExcess || 'STD 150 XS');
  const excessNumeric = EXCESS_LABEL[excessRaw] || '150';

  // Premium summary (parity with legacy print – TIV is the sum of section
  // limits A+B+D, premium is the actual annual cost.)
  const totalInsuredValue = buildings + contents + solarPanels;
  const netPremium = Number(breakdown.netPremium ?? policyResp.netPremium ?? 0);
  const iptAmount = Number(breakdown.iptAmount ?? policyResp.iptAmount ?? 0);
  const adminFee = Number(breakdown.adminFee ?? policyResp.adminFee ?? 0);
  const grossPremium = Number(breakdown.grossPremium ?? policyResp.annualPremium ?? netPremium + iptAmount + adminFee);
  // ADR-0056 — BDX declared-premium alignment. Home has no canonical
  // breakdown lines, so the loading/discount that reconciles the flat
  // net/IPT/admin components to the declared gross premium renders as its
  // own schedule row. Without it the components would sum to the
  // calculator's premium while the total shows the bordereau's.
  const bdxAlignmentRaw = Number(breakdown.bdxDeclaredAlignment ?? 0);
  const bdxAlignment = Number.isFinite(bdxAlignmentRaw) ? bdxAlignmentRaw : 0;

  const sectionsBreakdown = [
    {
      code: 'A',
      title: 'Buildings',
      sumAssured: buildings > 0 ? `${symbol}${moneyDisplayFixed(buildings)}` : 'Not Insured',
      sumAssuredAmount: buildings,
      excessNote: excessRaw === 'STD 150 XS'
        ? DEFAULT_BUILDINGS_EXCESS_NOTE
        : `Euro ${excessNumeric}.00 excess. ${DEFAULT_BUILDINGS_EXCESS_NOTE.replace('Euro 150.00 excess, ', '')}`,
      extraNotes: adBuildingsSelected ? ['Accidental Damage — Included'] : [],
    },
    {
      code: 'B',
      title: 'Contents in the home',
      excessLabel: `${symbol}${excessNumeric} excess`,
      sumAssured: contents > 0 ? `${symbol}${moneyDisplayFixed(contents)}` : 'Not Insured',
      sumAssuredAmount: contents,
      subLimits: [
        `Single Article High Risk Items Limit ${symbol}${moneyDisplay(DEFAULT_SINGLE_ARTICLE_JEWELLERY_LIMIT)}`,
        `Maximum per high-value contents item ${symbol}${moneyDisplay(maxTotalJewelleryLimit)} (20% of the contents sum insured)`,
        `Outbuildings Max Limit ${symbol}${moneyDisplay(DEFAULT_CONTENTS_OUTBUILDINGS_LIMIT)} with Single Article Limit ${symbol}${moneyDisplay(DEFAULT_CONTENTS_OUTBUILDINGS_SINGLE_ARTICLE)}`,
      ],
      extraNotes: adContentsSelected ? ['Accidental Damage — Included'] : [],
    },
    {
      code: 'C',
      title: 'High Risk Items and personal effects',
      excessLabel: `${symbol}${excessNumeric} excess`,
      coverScope: 'European All Risks cover',
      lines: [
        { label: 'All Risks Unspecified', value: allRiskOther > 0 ? `${symbol}${moneyDisplayFixed(allRiskOther)}` : '0.00', note: `(Single Article Limit ${symbol}${moneyDisplay(DEFAULT_SINGLE_ARTICLE_JEWELLERY_LIMIT)})` },
        { label: 'Specified Personal Effects', value: '0.00', note: '(sports equipment, baggage, mobile phones, laptops, camera etc)' },
        { label: 'Specified High Risk Items', value: allRiskJewellery > 0 ? `${symbol}${moneyDisplayFixed(allRiskJewellery)}` : '0.00' },
      ],
    },
    {
      code: 'D',
      title: 'Solar Panels',
      sumAssured: solarPanels > 0 ? `${symbol}${moneyDisplayFixed(solarPanels)}` : 'Not Insured',
      sumAssuredAmount: solarPanels,
    },
    {
      code: 'E',
      title: 'Liability',
      sumAssured: `Indemnity ${symbol}${moneyDisplayFixed(DEFAULT_LIABILITY_INDEMNITY)}`,
      inline: 'included',
    },
    {
      code: 'F',
      title: 'Emergency Travel',
      sumAssured: 'Included',
      footnote: [
        `${symbol}${DEFAULT_EMERGENCY_TRAVEL_PER_RETURN_TICKET} per return ticket`,
        `${symbol}${DEFAULT_EMERGENCY_TRAVEL_TEMP_ACCOM} for temporary accommodation and other expenses`,
        `${symbol}${moneyDisplay(DEFAULT_EMERGENCY_TRAVEL_TOTAL)} in total for any one Period of Insurance.`,
      ],
    },
  ];

  // Static endorsements applicable to every Cyprus Home policy under the
  // current binding authority (LBS0004J / B176025EEA6551). These are part
  // of the legacy Abbeygate schedule and are explicitly enumerated so the
  // generated PDF mirrors the legacy artifact 1:1.
  const endorsements = [
    {
      code: CV1020_SANCTIONS_CLAUSE.code,
      title: CV1020_SANCTIONS_CLAUSE.title,
      body: CV1020_SANCTIONS_CLAUSE.text,
    },
    {
      code: 'AB1',
      title: 'Acknowledgment of pre-contractual disclosure clause',
      body:
        'You acknowledge that you have received from us your policy booklet, or have viewed it online at https://www.abbeygate.com, which contains all relevant information relating to the law applicable to this contract of insurance, the various mechanisms for making claims, the member state in which our registered office is situated, the authority in charge of controlling our activities and our name, address and legal form.',
    },
    {
      code: 'AB14',
      title: 'Minimum Security and Protection Clause',
      body: [
        'It is Your duty to ensure that all protections provided for the security of the Home/Holiday Home and contents are:',
        '- maintained in good working order',
        '- in full and effective operation whenever You or any persons authorised are absent from the premises or have retired for the night.',
        'Loss by theft or attempted theft from the Home/Holiday Home is not covered unless the following security measures are in operation and there must be force and violence to gain entry into property:',
        'a) The final exit door is fitted with:',
        '  i. a key operated European cylinder lock or Yale lock; or',
        '  ii. a lock conforming to BS3621: 1998 or to a higher specification',
        'b) Other external doors excluding sliding patio or balcony doors to be fitted with either:',
        '  i) A lock to the standard in a) above or',
        '  ii) Key operated security devices top & bottom in addition to the existing locks',
        '  iii) Fixed or concertina bar/grilles with locks or bolting top and bottom into the structure of the building',
        'c) Sliding patio doors and Balcony Doors which are accessible from the ground are to be fitted with either:',
        '  i) Fixed minimum security internal locking system which is activated only by internal handles and not accessible externally.',
        '  ii) Key Operated Locks or Security locks activated only by internal handles',
        '  iii) Security Bolts top and bottom in addition to any existing lock',
        '  iv) Fixed or concertina bar/grills with locks or bolting top and bottom into the structure of the building',
        'd) All opening windows ground floor and those that are accessible on other floors are fitted with either:',
        '  i) Fixed minimum security internal locking system which is activated only by internal handles and not accessible externally.',
        '  ii) Key Operated Locks or Security locks activated only by internal handles',
        '  iii) Security Bolts top and bottom in addition to any existing lock',
        '  iv) Full length security shutters locked internally',
        '  v) Metal grilles or Rejas embedded into the wall',
        'If you fail to comply with the above duties this insurance will become invalid in respect of loss or damage resulting from unauthorised entry.',
      ].join('\n'),
    },
  ];

  // AB99 Deletion of Cover (subsidence/heave/landslip) is "only operative if
  // shown on Your Schedule". Territories where the binder does not offer
  // subsidence/heave/landslip cover must carry it on every schedule so the
  // wording's subsidence sections are formally deleted (PT go-live feedback —
  // the excess note stays on Section A because the wording requires the
  // applicable excess to be stated, hence "where included").
  if (SUBSIDENCE_COVER_DELETED_TERRITORIES.has(tenantConfig.countryCode)) {
    endorsements.push({
      code: 'AB99',
      title: 'Deletion of Cover Clause',
      body:
        "It is hereby declared and agreed that the cover of 'Subsidence or Heave of the site on which Your building(s) stand or land belonging to Your building(s), or landslip' is hereby deleted from the policy wording.",
    });
  }

  // AB106 Safe Conditions (Beazley/Lloyd's coverholder wording) is "only
  // operative if shown on Your Schedule" — attach it automatically whenever
  // the policy insures specified high risk items (Section C). This mirrors
  // the safe requirement enforced in the quote journey + underwriting.
  if (hasSpecifiedHighRiskItems(qd)) {
    endorsements.push({
      code: 'AB106',
      title: 'Safe Conditions',
      body:
        'This insurance excludes theft in respect of any jewellery or watches or any other valuables from the Home unless: a. such items are kept in a locked safe or strongbox weighing over 100kgs which must not be in an open position or, b. in a safe which is anchored to or completely embedded in the wall or floor, suitably concealed. Whenever the premises are left unattended by You or any authorised representatives, all keys and duplicate keys to the safe must be removed from the Home.',
    });
  }

  if (requiresHolidayHomeInspectionEndorsement(usage)) {
    endorsements.push(HOME_HOLIDAY_UNOCCUPIED_INSPECTION_ENDORSEMENT);
  }

  const specifiedItemsRaw = Array.isArray(coverage.specifiedItems)
    ? (coverage.specifiedItems as unknown[])
    : Array.isArray(qd.specifiedItems)
      ? (qd.specifiedItems as unknown[])
      : [];
  const specifiedItems = specifiedItemsRaw
    .map((row) => asRecord(row))
    .map((row) => {
      const serialNumber = safeStr(row.serialNumber || row.serial);
      const description = [
        safeStr(row.description || row.label || row.name),
        safeStr(row.make),
        safeStr(row.model),
        serialNumber ? `Serial: ${serialNumber}` : '',
      ].filter(Boolean).join(' · ');
      return {
        description,
        sumInsuredDisplay: row.sumInsured ? `${symbol}${moneyDisplayFixed(row.sumInsured)}` : '—',
      };
    })
    .filter((row) => row.description);

  const policyNumber = safeStr(policy.policyNumber || policy.id);
  // UMR is the bound binder's Unique Market Reference — never the policy number.
  const umrValue = safeStr(policy.umr || policy.binderUmr);
  const bankMortgageReference = safeStr(mortgage.lenderReference || mortgage.reference || qd.bankMortgageReference || '');
  const mortgageLenderName = safeStr(mortgage.lenderName || '');
  const mortgageLenderAddress = safeStr(mortgage.lenderAddress || mortgage.address || '');
  const permanentHomeValue = usage.permanentHome ?? property.permanentHome;
  const additionalSecurityDescription = safeStr(security.additionalSecurityDescription || security.otherSecurityDescription);

  return {
    // ─── Document identifiers ────────────────────────────────────────────
    policyNumber,
    certificateNumber: safeStr(policy.certificateNumber || ''),
    umr: umrValue,
    coverholderUmr: umrValue,
    policyWording: policyWordingReference,
    tenant: { countryName: tenantConfig.country, countryCode: tenantConfig.countryCode },

    // ─── Lloyd's cover page ─────────────────────────────────────────────
    generatedDate: formatDateNumeric(issueDate),
    issueDateDisplay: formatDateNumeric(issueDate),
    lloydsRegistration: '682.594.839',
    lloydsBankDetails: 'Citibank Europe plc Belgium Branch, Boulevard General Jacques 263G, Brussels 1050, Belgium - BE46570135225536.',
    lloydsWebsite: 'www.lloyds.com/brussels',
    lloydsEmail: 'enquiries.lloydsbrussels@lloyds.com',

    // ─── Insured / property ─────────────────────────────────────────────
    policyHolder: {
      name: holderName,
      firstName: firstNameDisplay,
      surname: surnameDisplay,
      email: holderEmail,
      phone: holderPhone,
      jointProposers,
      jointProposer,
      dateOfBirthDisplay: formatDate(safeStr(proposer.dateOfBirth)),
      nationality: safeStr(proposer.nationality || '—'),
      domicileCountry: safeStr(proposer.domicileCountry || '—'),
      addressDisplay: formatPersonAddress(proposer.address) || '—',
      addressMultiline: correspondenceAddressMultiline || '—',
      occupation: safeStr(proposer.occupation || '—'),
      nif: safeStr(proposer.nif || '—'),
    },
    period: {
      startDisplay: formatDate(inceptionDate),
      endDisplay: formatDate(expiryDate),
      startNumeric: formatDateNumeric(inceptionDate),
      endNumeric: formatDateNumeric(expiryDate),
    },
    property: {
      typeLabel: safeStr(property.propertyType || 'Property'),
      yearBuilt: safeStr(property.yearBuilt || '—'),
      bedrooms: safeStr(property.bedrooms || '—'),
      floorAreaSqm: safeStr(property.floorAreaSqm || '—'),
      addressDisplay: propertyAddressDisplay || '—',
      addressMultiline: propertyAddressMultiline || '—',
      permanentHomeLabel: yesNo(property.permanentHome),
      woodenConstructionLabel: yesNo(property.woodenConstruction),
      nonCombustibleLabel: yesNo(property.nonCombustibleMaterial),
      alarmLabel: yesNo(property.alarm),
      brickStoneConcreteLabel: yesNo(property.brickStoneConcrete ?? property.nonCombustibleMaterial),
      goodStateOfRepairLabel: yesNo(property.goodStateOfRepair ?? true),
      stormFloodHistoryLabel: yesNo(property.stormFloodHistory ?? false),
      floodPast10YearsLabel: yesNo(property.floodPast10Years ?? false),
      waterCoursesNearbyLabel: yesNo(property.waterCoursesNearby ?? false),
      aboveShopOrBusinessLabel: yesNo(property.aboveShopOrBusiness ?? false),
    },
    usage: {
      permanentHomeLabel: yesNo(permanentHomeValue),
      propertyUseLabel: propertyUseLabel(permanentHomeValue),
      businessUseLabel: yesNo(usage.businessUse),
      rentedOutLabel: yesNo(usage.rentedOut),
      unoccupancyLabel: unoccupancyLabel(usage.unoccupancyDays ?? property.unoccupancyDays ?? 30),
    },
    security: {
      doorsFiveLeverLocksLabel: yesNo(security.doorsFiveLeverLocks),
      windowsSecuredLabel: yesNo(security.windowsSecured),
      additionalSecurityLabel: yesNo(security.additionalSecurity),
      alarmMaintainedLabel: yesNo(security.alarmMaintained ?? false),
      safeOnPremisesLabel: yesNo(security.safeOnPremises ?? false),
      safeDescription: safeStr(security.safeDescription || 'None'),
      additionalSecurityDescription: additionalSecurityDescription || (security.additionalSecurity === true ? 'Yes' : 'None'),
    },
    risk: {
      previousClaims: safeStr(risk.previousClaims || 'None'),
      noClaimsDiscount: safeStr(risk.noClaimsDiscount || '0 Years'),
      increasedExcess: excessRaw,
      proposerOver45Label: yesNo(risk.proposerOver45),
      previousDeclinedLabel: yesNo(risk.previousDeclined ?? false),
      arsonDishonestyLabel: yesNo(risk.arsonDishonesty ?? false),
      previousLossLabel: yesNo(risk.previousLoss ?? false),
      subsidenceDamageLabel: yesNo(risk.subsidenceDamage ?? false),
      subsidenceMovementLabel: yesNo(risk.subsidenceMovement ?? false),
      subsidenceSurveyLabel: yesNo(risk.subsidenceSurvey ?? false),
    },
    coverage: {
      buildingsDisplay: moneyDisplay(buildings),
      contentsDisplay: moneyDisplay(contents),
      excessDisplay: excessNumeric,
      allRiskJewellery,
      allRiskJewelleryDisplay: moneyDisplay(allRiskJewellery),
      allRiskOther,
      allRiskOtherDisplay: moneyDisplay(allRiskOther),
      solarPanels,
      solarPanelsDisplay: moneyDisplay(solarPanels),
      adBuildingsLabel: yesNo(adBuildingsSelected),
      adContentsLabel: yesNo(adContentsSelected),
      europAssistanceLabel: yesNo(europAssistanceSelected),
    },
    sections: sectionsBreakdown,
    endorsements,
    specifiedItems,
    bankMortgageReference,
    mortgageLenderName,
    mortgageLenderAddress,
    acceptance: {
      confirmationLabel: yesNo(eligibility.confirmation),
      policyStartDateDisplay: formatDate(safeStr(policyPeriod.startDate)),
    },
    addonsLabels,
    currency,
    currencySymbol: symbol,
    premium: {
      net: num2(netPremium),
      ipt: num2(iptAmount),
      adminFee: num2(adminFee),
      gross: num2(grossPremium),
      bdxAlignment: num2(bdxAlignment),
    },
    premiumSummary: {
      totalInsuredValueDisplay: moneyDisplayFixed(totalInsuredValue),
      netPremiumDisplay: moneyDisplayFixed(netPremium),
      localTaxesDisplay: moneyDisplayFixed(iptAmount),
      adminChargeDisplay: moneyDisplayFixed(adminFee),
      // Signed, symbol included ("-€40.00" / "€15.50"); empty when there is
      // no alignment so the template row collapses entirely.
      bdxAlignmentAmountDisplay: bdxAlignment !== 0
        ? `${bdxAlignment < 0 ? '-' : ''}${symbol}${moneyDisplayFixed(Math.abs(bdxAlignment))}`
        : '',
      totalPremiumDisplay: moneyDisplayFixed(grossPremium),
    },
    signatory: {
      brokerLegalName: 'Abbeygate Insurance Brokers Limited',
      brokerAddressOneLine: '1 Mesogi Avenue, Paphos, 8280, Cyprus',
      authorisedSignerName: 'Andrew Francis',
      authorisedSignerTitle: 'Signed, on behalf of Abbeygate',
    },
    legalContacts: {
      coverholderName: 'Abbeygate Insurance Brokers Limited',
      coverholderAddress: '1 Mesogi Avenue, Paphos, 8280, Cyprus',
      lloydsGeneralRepresentative: "Named and Detailed in the Policy Wording",
      serviceOfSuit: 'Marianna Papadakis. Lloyd\'s Cyprus Limited, 41-49 Agiou Niclaou Street. Nimeli Court, Block C, 3rd Floor, 2408 Engomi, Cyprus',
      claimNotification: 'Abbeygate Insurance',
      complaintHandling: 'Fully Detailed in your Policy wording or contact Abbeygate.',
      governingLaw: `${tenantConfig.country === 'Cyprus' ? 'Cypriot' : tenantConfig.country} Law`,
      jurisdiction: `${tenantConfig.country === 'Cyprus' ? 'Cypriot' : tenantConfig.country} Law`,
    },
  };
}
