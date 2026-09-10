import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { resolveVehicleUseLimitations } from '../../../modules/documents/domain/wording/vehicleUseLimitations.js';
import { MagicBRegistry } from '../../../modules/mbe/domain/registry.js';
import Handlebars from 'handlebars';
import type { JurisdictionProductConfig, TaxBreakdown } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import { resolveJurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import {
  CV1020_SANCTIONS_CLAUSE,
  CV1020_HEADING_LINE,
  isSupersededSanctionsCode,
} from '../../shared/documents/sanctionsClause.js';

type UnknownRecord = Record<string, unknown>;
type EndorsementDocRow = UnknownRecord & { templateCode: string };
type UwAdjustmentDoc = {
  id?: string;
  lineType?: 'pricing' | 'schedule_note';
  name?: string;
  type?: 'discount' | 'loading';
  mode?: 'pct' | 'amount';
  value?: number;
  reason?: string;
  reasonText?: string;
  text?: string;
  category?: 'EXCLUSION' | 'SUB_LIMIT' | 'CONDITION_WARRANTY' | 'OTHER';
  scopeType?: 'policy' | 'coverage';
  scopeRef?: string;
  schedulePresentation?: 'inherent' | 'separate_line';
  endorsementId?: string | null;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function safeStr(v: unknown) {
  return String(v ?? '').trim();
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const str = safeStr(value);
    if (str) return str;
  }
  return '';
}

function policyHolderName(holder: UnknownRecord): string {
  return [safeStr(holder.firstName), safeStr(holder.lastName)].filter(Boolean).join(' ').trim();
}

function policyHolderAddressMultiline(holder: UnknownRecord): string {
  const address = asRecord(holder.address);
  return [
    safeStr(address.line1),
    safeStr(address.city),
    safeStr(address.province),
    safeStr(address.country),
    safeStr(address.postcode),
  ].filter(Boolean).join('\n');
}

function additionalPolicyHolderRows(value: unknown): UnknownRecord[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.map((row) => asRecord(row)).map((holder, index) => ({
    name: policyHolderName(holder) || `Policy holder ${index + 2}`,
    address_multiline: policyHolderAddressMultiline(holder) || '—',
    email: safeStr(holder.email) || '—',
    phone: safeStr(holder.phone) || '—',
    date_of_birth: safeStr(holder.dateOfBirth) ? fmtDateDMY(safeStr(holder.dateOfBirth)) : '—',
    nationality: safeStr(holder.nationality) || '—',
    identity_number: safeStr(holder.nif) || '—',
    occupation: safeStr(holder.occupation) || '—',
  }));
}

type DriversBlock = {
  age_band: string;
  entitled_classes: string;
  named: Array<{ full_name: string; date_of_birth: string; license_type: string; years_held: string }>;
  named_csv: string;
  named_none_text: string;
};

/**
 * Build the certificate / statement drivers block from the canonical
 * `driverRestriction` enum (ABY-232 / ADR-0025). The age-band and
 * entitled-classes wording are no longer hard-coded — they vary by
 * coverage mode so the certificate and statement-of-fact match the
 * policy the customer actually bought.
 *
 * Legacy quotes (pre-ABY-232) with no `driverRestriction` value fall
 * back to the historical certificate copy ("aged between 25 and 70")
 * to keep document parity for existing in-force policies. The motor
 * adapter's normalize step will populate `driverRestriction` on read,
 * so this fallback should rarely trigger in practice.
 */
function buildDriversBlock(args: {
  driverRestriction: unknown;
  insuredName: string;
  additionalDrivers: UnknownRecord[];
}): DriversBlock {
  const { driverRestriction, insuredName, additionalDrivers } = args;
  const namedRows = additionalDrivers.map((driver) => {
    const firstName = safeStr(driver.firstName);
    const lastName = safeStr(driver.lastName);
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    return {
      full_name: fullName || '—',
      date_of_birth: safeStr(driver.dateOfBirth) ? fmtDateDMY(safeStr(driver.dateOfBirth)) : '—',
      license_type: safeStr(driver.licenseType) || '—',
      years_held: safeStr(driver.licenseYears) || '—',
    };
  });
  const namedNames = [insuredName || '', ...namedRows.map((r) => r.full_name).filter((n) => n && n !== '—')]
    .filter(Boolean);
  const namedCsv = namedNames.join(', ') || '—';

  switch (driverRestriction) {
    case 'POLICYHOLDER_ONLY':
      return {
        age_band: '—',
        entitled_classes: 'The Policyholder only.',
        named: [],
        named_csv: insuredName || '—',
        named_none_text: 'Named Drivers: Policyholder only (no additional drivers).',
      };
    case 'NAMED_DRIVERS':
      return {
        age_band: '—',
        entitled_classes:
          "The Policyholder and the Named Drivers listed in this Certificate, driving on the Policyholder's orders with the Policyholder's permission.",
        named: namedRows,
        named_csv: namedCsv,
        named_none_text:
          namedRows.length === 0
            ? 'Named Drivers: None (Policyholder only).'
            : `Named Drivers: ${namedCsv}.`,
      };
    case 'ANY_DRIVER_25_PLUS':
      return {
        age_band: '25 and 70',
        entitled_classes:
          "The Policyholder and any authorised driver aged between 25 and 70 who is driving on the Policyholder's orders with the Policyholder's permission.",
        named: [],
        named_csv: insuredName || '—',
        named_none_text: 'Named Drivers: None (open driving conditions apply as per Certificate, ages 25–70).',
      };
    case 'ANY_DRIVER_40_PLUS':
      return {
        age_band: '40 and 70',
        entitled_classes:
          "The Policyholder and any authorised driver aged between 40 and 70 who is driving on the Policyholder's orders with the Policyholder's permission.",
        named: [],
        named_csv: insuredName || '—',
        named_none_text: 'Named Drivers: None (open driving conditions apply as per Certificate, ages 40–70).',
      };
    default:
      // Legacy fallback for pre-ABY-232 quotes — kept to preserve
      // document parity for existing in-force policies until they
      // are re-rated.
      return {
        age_band: '25 and 70',
        entitled_classes:
          "The Policyholder and any authorised driver aged between 25 and 70 who is driving on the Policyholder's orders with the Policyholder's permission.",
        named: [],
        named_csv: insuredName || '—',
        named_none_text: 'Named Drivers: None (open driving conditions apply as per Certificate)',
      };
  }
}

function titleCaseWords(s: string) {
  return String(s || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function parseUwAdjustments(rawQuoteData: UnknownRecord): UwAdjustmentDoc[] {
  const rawArray = Array.isArray(rawQuoteData.uwAdjustments) ? rawQuoteData.uwAdjustments : null;
  const rawLegacy = asRecord(rawQuoteData.uwAdjustment);
  const source = rawArray || (rawLegacy.type || rawLegacy.value ? [rawLegacy] : []);
  const out: UwAdjustmentDoc[] = [];

  source.forEach((entry, idx) => {
    const rec = asRecord(entry);
    const lineTypeRaw = String(rec.lineType || '').toLowerCase();
    const lineType = lineTypeRaw === 'schedule_note' ? 'schedule_note' : 'pricing';
    const type = String(rec.type || '').toLowerCase() === 'loading' ? 'loading' : String(rec.type || '').toLowerCase() === 'discount' ? 'discount' : null;
    if (lineType === 'pricing' && !type) return;
    const mode = String(rec.mode || '').toLowerCase() === 'amount' ? 'amount' : 'pct';
    const value = Number(rec.value);
    if (lineType === 'pricing' && !Number.isFinite(value)) return;
    const scopeType = String(rec.scopeType || '').toLowerCase() === 'coverage' ? 'coverage' : 'policy';
    const scopeRef = String(rec.scopeRef || '').trim() || undefined;
    const reasonText = String(rec.reasonText || rec.reason || '').trim();
    const schedulePresentation =
      String(rec.schedulePresentation || '').toLowerCase() === 'separate_line' ? 'separate_line' : 'inherent';
    const categoryRaw = String(rec.category || '').toUpperCase();
    const category = ['EXCLUSION', 'SUB_LIMIT', 'CONDITION_WARRANTY', 'OTHER'].includes(categoryRaw)
      ? categoryRaw as 'EXCLUSION' | 'SUB_LIMIT' | 'CONDITION_WARRANTY' | 'OTHER'
      : 'OTHER';
    const text = String(rec.text || '').trim();
    out.push({
      id: String(rec.id || '').trim() || `uw-adjustment-${idx + 1}`,
      lineType,
      name: String(rec.name || '').trim() || undefined,
      type: type || undefined,
      mode: mode || undefined,
      value: Number.isFinite(value) ? value : undefined,
      reason: reasonText || undefined,
      reasonText: reasonText || undefined,
      text: text || undefined,
      category,
      scopeType,
      scopeRef,
      schedulePresentation,
      endorsementId: String(rec.endorsementId || '').trim() || null,
    });
  });

  return out;
}

type PremiumRow = { itemCode: string; amount: string };

// Helper to format currency
const fmtMoney = (amount: number) => {
  return new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
};

function isEmbeddedWindscreenPremiumRow(step: UnknownRecord): boolean {
  const id = String(step.id || '').trim().toUpperCase();
  const name = String(step.name || '').trim().toUpperCase();
  return id === 'ENDORSEMENT.PREMIUM.CV 24' || name === 'WINDSCREEN';
}

// Helper to format date
const fmtDate = (date: Date | string) => {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtDateDMY = (date: Date | string) => {
  if (!date) return '';
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
};

function nearlyEqual(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(a - b) <= epsilon;
}

export type MotorDocViewModel = Record<string, unknown>;

const GREEN_CARD_ALL_TERRITORY_CODES = [
  // Common Green Card system country codes (EU + adjacent / common extensions)
  'A', 'AL', 'AND', 'ARM', 'AZ', 'B', 'BG', 'BIH', 'BY', 'CH', 'CY', 'CZ', 'D', 'DK', 'E', 'EST', 'F', 'FIN', 'GB',
  'GE', 'GR', 'H', 'HR', 'I', 'IL', 'IR', 'IRL', 'IS', 'L', 'LT', 'LV', 'MA', 'MD', 'MK', 'MNE', 'N', 'NL', 'P',
  'PL', 'RO', 'RSM', 'RUS', 'S', 'SK', 'SLO', 'SRB', 'TN', 'TR', 'UA',
];

export function buildMotorDocViewModel(args: {
  policy: UnknownRecord;
  snap: UnknownRecord;
  activeEndorsements: UnknownRecord[];
  appliedEndorsements?: Array<{ code: string; params?: UnknownRecord }>;
  mbeSections: { coverages: UnknownRecord[]; conditions: UnknownRecord[]; assistance: UnknownRecord | null; premiumRows?: PremiumRow[] };
  normalizedMbeCfg?: UnknownRecord;
  greenCardSerial: string | null;
  brand: UnknownRecord;
  assetsBasePath: string;
  jurisdictionConfig?: JurisdictionProductConfig;
}): MotorDocViewModel {
  const { policy, snap, activeEndorsements, appliedEndorsements, mbeSections, normalizedMbeCfg, greenCardSerial, brand, assetsBasePath } = args;

  const qd = asRecord(snap.quoteData);
  const qr = asRecord(snap.quoteResponse);
  const primaryOption = asRecord(qr.primaryOption);

  const inceptionDate = new Date(String(policy.inceptionDate || ''));
  const expiryDate = new Date(String(policy.expiryDate || ''));
  const policyHolder = asRecord(policy.policyHolder);
  const binder = asRecord(policy.binder);
  const policyPrev = asRecord(policy.previousPolicy);
  const jurisdictionConfig = args.jurisdictionConfig || resolveJurisdictionProductConfig({
    productCode: 'MOTOR',
    binder: {
      id: safeStr(binder.id) || safeStr(policy.binderId),
      config: binder.config,
    },
    program: {
      id: safeStr(policy.programId),
    },
    tenant: getTenantConfig(),
  });
  const docConfig = jurisdictionConfig.documentConfig;
  const greenCardConfig = jurisdictionConfig.greenCardConfig;

  const proposer = asRecord(qd.proposer);
  const proposerAddress = asRecord(proposer.address);
  const additionalPolicyHolders = additionalPolicyHolderRows(qd.policyHolders);

  const policyholderIdentityNumber = firstNonEmpty(
    qd.policyholderIdentityNumber,
    qd.identityCardNumber,
    qd.identityNumber,
    qd.idNumber,
    proposer.nif
  );

  const insuredCountry = firstNonEmpty(
    proposerAddress.country,
    proposer.domicileCountry,
    qd.countryOfResidence,
    qd.residenceCountry,
    qd.countryCode,
    getTenantConfig().country
  );

  // Address
  const insuredAddressObj = {
    line1: safeStr(proposerAddress.line1),
    city: safeStr(proposerAddress.city),
    postcode: safeStr(proposerAddress.postcode),
    country: insuredCountry,
  };

  const reasonForIssue = (() => {
    const txType = safeStr(snap.transactionType || snap.riskTransactionType || '').toUpperCase();
    const hasPriorPolicyLink = Boolean(
      safeStr(qd.previousPolicyNumber) || safeStr(policy.previousPolicyNumber) || safeStr(policyPrev.policyNumber)
    );
    if (txType.includes('ENDORSE')) return 'Endorsement';
    if (txType.includes('RENEW') || hasPriorPolicyLink) return 'Renewal';
    return 'New business';
  })();

  // Vehicles
  const bodyTypeRaw = safeStr(qd.body_type || qd.bodyType || '');
  const cabrioRaw = safeStr(qd.cabrio || qd.convertible || '');
  const isConvertible =
    cabrioRaw.toLowerCase() === 'yes' || bodyTypeRaw.toLowerCase().includes('convert') || bodyTypeRaw.toLowerCase().includes('cabrio');
  const bodyTypeDisplay = isConvertible ? 'Cabriolet' : (bodyTypeRaw ? titleCaseWords(bodyTypeRaw) : '');
  const fuelType = safeStr(qd.fuelType);
  const isElectricVehicle = fuelType === 'Electric';
  const electricPowerKw = Number(qd.electricPowerKw || 0);
  const engineSizeCc = Number(qd.engineSize || 0);
  const powertrainDisplay = isElectricVehicle
    ? (electricPowerKw > 0 ? `${electricPowerKw} kW` : '')
    : (engineSizeCc > 0 ? `${engineSizeCc}cc` : '');

  const vehicle0 = {
    reg: safeStr(qd.registrationNumber),
    make: safeStr(qd.make),
    model: safeStr(qd.model),
    year: qd.year,
    engine_cc: engineSizeCc,
    electric_power_kw: electricPowerKw > 0 ? electricPowerKw : null,
    powertrain_display: powertrainDisplay,
    seating_capacity: Number(qd.numberOfSeats || 0),
    estimated_value_eur: fmtMoney(Number(qd.vehicleValue || 0)),
    fuel: fuelType,
    body_type: bodyTypeDisplay,
    is_convertible: Boolean(isConvertible),
    description_full: (() => {
      const parts: string[] = [];
      const makeModel = [safeStr(qd.make), safeStr(qd.model)].filter(Boolean).join(' ');
      if (makeModel) parts.push(makeModel);
      if (powertrainDisplay) parts.push(`(${powertrainDisplay})`);
      const fuel = fuelType;
      if (fuel) parts.push(fuel);
      const reg = safeStr(qd.registrationNumber);
      if (reg) parts.push(reg);
      return parts.join(' ').replace(/\s+/g, ' ').trim() || safeStr(qd.registrationNumber);
    })(),
    description_green_card: (() => {
      const parts: string[] = [];
      const makeModel = [safeStr(qd.make), safeStr(qd.model)].filter(Boolean).join(' ');
      if (makeModel) parts.push(makeModel);
      if (powertrainDisplay) parts.push(`(${powertrainDisplay})`);
      const fuel = fuelType;
      if (fuel) parts.push(fuel);
      return parts.join(' ').replace(/\s+/g, ' ').trim() || safeStr(qd.registrationNumber);
    })(),
  };
  const vehicles = [vehicle0];

  // Endorsements (policy instances)
  const endorsementsFromInstances: EndorsementDocRow[] = (activeEndorsements || []).map((e) => {
    const eRecord = asRecord(e);
    const templateRecord = asRecord(eRecord.template);
    const effects = Array.isArray(asRecord(templateRecord.rules).effects) ? (asRecord(templateRecord.rules).effects as unknown[]) : [];
    const effectType = effects.length ? String(asRecord(effects[0]).type || '') : '';
    const headingLine = (() => {
      const code = String(eRecord.code || '').trim();
      const title = String(eRecord.title || '').trim();
      const params = asRecord(eRecord.params);
      const amt = Number(params.excess_amount_eur ?? params.additional_excess_eur ?? params.deductible_eur);
      if (code && title && Number.isFinite(amt) && amt > 0) {
        const suffix = code === 'CV 4' ? `. ${Math.round(amt)} Euros` : ` ${Math.round(amt)} Euros`;
        return `${code}. ${title}${suffix}`;
      }
      return code && title ? `${code}. ${title}` : code || title;
    })();
    return {
      templateCode: String(eRecord.code || ''),
      title: eRecord.title,
      description: templateRecord.description || eRecord.code,
      status: eRecord.status,
      params: asRecord(eRecord.params),
      premiumImpact: Number(eRecord.premiumDelta) !== 0 ? fmtMoney(Number(eRecord.premiumDelta)) : null,
      effectType: effectType || null,
      headingLine,
    };
  });

  const endorsementsFromApplied = (() => {
    const applied = Array.isArray(appliedEndorsements) ? appliedEndorsements : [];
    const out: EndorsementDocRow[] = [];
    const motorCatalog = MagicBRegistry.motorOnly();
    for (const a of applied) {
      const code = String(a?.code || '').trim();
      if (!code) continue;
      const tmpl = motorCatalog.get(code);
      if (!tmpl) continue;
      const tmplRecord = asRecord(tmpl);
      // Skip core cover rows; those appear in Coverage & Limits.
      if (String(tmplRecord.type || '').toUpperCase() === 'COVERAGE') continue;
      if (String(tmplRecord.type || '').toUpperCase() === 'ASSISTANCE') continue;

      const params = asRecord(a?.params);
      // Best-effort "value" presentation (matches schedule style for excess amounts).
      const excessLike = Number(params.excess_amount_eur ?? params.additional_excess_eur ?? params.deductible_eur);
      const premiumImpact = Number.isFinite(excessLike) && excessLike > 0 ? String(Math.round(excessLike)) : null;

      // Match schedule pagination: sanctions exclusion typically ends page 3, then CV1029 starts page 4.
      const pageBreakBefore = code === 'CV 1029';

      const renderLegalText = (txt: string) => {
        try {
          return Handlebars.compile(txt, { noEscape: true })(params || {});
        } catch {
          return txt;
        }
      };

      const headingLine = (() => {
        const title = String(tmplRecord.title || code).trim();
        // Amounts on CV4/CV5 (and similar "excess_amount_eur") are printed in the header line.
        // Convertible roof extra excess (CV7) is described inside the clause, not in the header.
        if (code === 'CV 7') return `${code}. ${title}`;
        const amt = Number(params.excess_amount_eur);
        if (Number.isFinite(amt) && amt > 0) {
          const suffix = code === 'CV 4' ? `. ${Math.round(amt)} Euros` : ` ${Math.round(amt)} Euros`;
          return `${code}. ${title}${suffix}`;
        }
        return `${code}. ${title}`;
      })();

      out.push({
        templateCode: code,
        title: String(tmplRecord.title || code),
        description: renderLegalText(String(tmplRecord.legal_text || tmplRecord.summary || code)),
        status: 'APPLIED',
        params,
        premiumImpact,
        effectType: String(tmplRecord.type || '') || null,
        pageBreakBefore,
        headingLine,
      });
    }

    // Order: excesses → vehicle location → sanctions → premium warranty → classic extensions.
  const ORDER = ['CV 4', 'CV 5', 'CV 6', 'CV 7', 'CV 23', 'CV 24', 'CV 46', 'CV 47', 'CV 172', 'CV 999', 'CV 1028', 'CV 1029', 'ABG001'];
    const idx = new Map<string, number>(ORDER.map((c, i) => [c, i]));
    out.sort((a, b) => {
      const ai = idx.has(a.templateCode) ? (idx.get(a.templateCode) as number) : 999;
      const bi = idx.has(b.templateCode) ? (idx.get(b.templateCode) as number) : 999;
      if (ai !== bi) return ai - bi;
      return String(a.templateCode).localeCompare(String(b.templateCode));
    });

    return out;
  })();

  const uwAdjustmentsAsEndorsements = (() => {
    const primary = asRecord(qr.primaryOption);
    const trace = asRecord(primary.calculationTrace);
    const steps = Array.isArray(trace.steps) ? trace.steps : [];
    const adjustments = parseUwAdjustments(qd);
    const out: EndorsementDocRow[] = [];

    adjustments.forEach((adj, idx) => {
      if (adj.lineType === 'schedule_note') return;
      if (adj.schedulePresentation !== 'separate_line') return;
      const step = asRecord(steps.find((s) => asRecord(s).id === `uw.adjustment.${idx}`));
      const amount = Number(step.amount);
      if (!Number.isFinite(amount) || amount === 0) return;

      const adjValue = Number(adj.value ?? 0);
      const modeLabel = adj.mode === 'pct' ? `${adjValue}%` : `EUR ${fmtMoney(adjValue)}`;
      const typeLabel = adj.type === 'discount' ? 'Discount' : 'Loading';
      const title = adj.name || adj.reason || `Underwriter adjustment ${idx + 1}`;

      out.push({
        templateCode: `UW-ADJ-${String(adj.id || idx + 1)}`,
        title,
        description: '',
        status: 'APPLIED',
        effectType: 'UW_ADJUSTMENT',
        headingLine: `${title}. ${typeLabel} (${modeLabel})`,
        premiumImpact: fmtMoney(amount),
      });
    });

    return out;
  })();

  const scheduleNotes = (() => {
    const adjustments = parseUwAdjustments(qd);
    return adjustments
      .filter((adj) => adj.lineType === 'schedule_note')
      .map((adj, idx) => ({
        id: String(adj.id || `schedule-note-${idx + 1}`),
        category: String(adj.category || 'OTHER'),
        title: String(adj.name || `Schedule note ${idx + 1}`),
        text: String(adj.text || '').trim(),
        endorsementId: adj.endorsementId || null,
      }))
      .filter((note) => note.text.length > 0);
  })();

  // De-dupe by code (policy-level instances override applied defaults where present)
  const endorsements = (() => {
    const m = new Map<string, EndorsementDocRow>();
    endorsementsFromApplied.forEach((e) => m.set(String(e.templateCode), e));
    endorsementsFromInstances.forEach((e) => m.set(String(e.templateCode), e));
    uwAdjustmentsAsEndorsements.forEach((e) => m.set(String(e.templateCode), e));
    // Drop any legacy sanctions endorsement (e.g. CV 1028) so the schedule never
    // prints two competing sanctions clauses. CV1020 supersedes it below.
    for (const key of Array.from(m.keys())) {
      if (isSupersededSanctionsCode(key)) m.delete(key);
    }
    // Mandatory binder-wide sanctions endorsement (CV1020). Always printed
    // on the schedule; single source of truth in shared/documents.
    m.set(CV1020_SANCTIONS_CLAUSE.code, {
      templateCode: CV1020_SANCTIONS_CLAUSE.code,
      code: CV1020_SANCTIONS_CLAUSE.code,
      title: CV1020_SANCTIONS_CLAUSE.title,
      headingLine: CV1020_HEADING_LINE,
      description: CV1020_SANCTIONS_CLAUSE.text,
      status: 'APPLIED',
      premiumImpact: null,
      effectType: null,
    });
    return Array.from(m.values());
  })();

  const coverages = mbeSections.coverages;
  const conditions = mbeSections.conditions;
  const assistance = (() => {
    const a = mbeSections.assistance ? { ...mbeSections.assistance } : null;
    if (!a) return null;
    a.provider = docConfig.assistanceProvider;
    a.tel = docConfig.assistanceTelephone;
    if (!Array.isArray(a.restrictions)) a.restrictions = [];
    return a;
  })();

  // Premium
  const cost = asRecord(primaryOption.costDetails);
  const trace = asRecord(primaryOption.calculationTrace);
  const traceSteps = Array.isArray(trace.steps) ? trace.steps : [];
  const taxRows = (Array.isArray(cost.taxRows) ? cost.taxRows : Array.isArray(trace.taxRows) ? trace.taxRows : []) as TaxBreakdown[];
  const addOnRowsFromTrace: PremiumRow[] = traceSteps
    .filter((step) => {
      const row = asRecord(step);
      return String(row.id || '').startsWith('endorsement.premium.') && !isEmbeddedWindscreenPremiumRow(row);
    })
    .map((step) => {
      const row = asRecord(step);
      const name = String(row.name || '').trim();
      const amount = Number(row.amount);
      if (!name || !Number.isFinite(amount) || amount === 0) return null;
      return { itemCode: name, amount: fmtMoney(amount) };
    })
    .filter((row): row is PremiumRow => Boolean(row));
  const addOnRowsFromMbe = Array.isArray(mbeSections.premiumRows)
    ? mbeSections.premiumRows.filter((row) => String(asRecord(row).itemCode || '').trim().toUpperCase() !== 'WINDSCREEN')
    : [];
  const addOnRows = addOnRowsFromTrace.length > 0 ? addOnRowsFromTrace : addOnRowsFromMbe;
  const addOnsTotalAmount = addOnRows.reduce((sum, r) => sum + (Number(String(r.amount).replace(/[^0-9.]/g, '')) || 0), 0);
  const premiumAmount = Number(cost.subtotalNetPremium ?? 0);
  const mifAmount = Number(cost.mifSurcharge ?? 0);
  const stampDutyAmount = Number(cost.stampDuty ?? cost.policyFee ?? 0);
  const baseInsuranceAmount = premiumAmount + mifAmount + stampDutyAmount;
  const quotedTotalAmount = Number(cost.totalPremium ?? snap.premium ?? baseInsuranceAmount);
  const quotedTotalIncludesAddOns =
    addOnsTotalAmount > 0 &&
    nearlyEqual(quotedTotalAmount, baseInsuranceAmount + addOnsTotalAmount);
  const insuranceTotalAmount = quotedTotalIncludesAddOns
    ? baseInsuranceAmount
    : quotedTotalAmount;
  const grandTotalAmount = quotedTotalIncludesAddOns
    ? quotedTotalAmount
    : insuranceTotalAmount + addOnsTotalAmount;

  const premiumBreakdown = {
    premium: fmtMoney(premiumAmount),
    mif: fmtMoney(mifAmount),
    stampDuty: fmtMoney(stampDutyAmount),
    total: fmtMoney(insuranceTotalAmount),
    addOnsTotal: fmtMoney(addOnsTotalAmount),
    grandTotal: fmtMoney(grandTotalAmount),
  };

  const assistancePremiumEur = addOnRows.reduce((sum, r) => {
    const key = String(r.itemCode || '').toLowerCase();
    if (key.includes('breakdown') || key.includes('roadside')) return sum + (Number(String(r.amount).replace(/[^0-9.]/g, '')) || 0);
    return sum;
  }, 0);
  const totalPaidToAbbeygateEur = grandTotalAmount;

  const configuredInsuranceRows = docConfig.premiumDisplay.ordering
    .map((code) => {
      if (code === 'NET_PREMIUM') return { itemCode: docConfig.premiumDisplay.labels[code] || 'PREMIUM', amount: fmtMoney(premiumAmount) };
      const row = taxRows.find((item) => String(item.code) === code);
      if (!row) return null;
      if (!docConfig.premiumDisplay.showTaxBreakdown && code !== 'MIF' && code !== 'STAMP_DUTY') return null;
      return {
        itemCode: docConfig.premiumDisplay.labels[code] || code,
        amount: fmtMoney(Number(row.amount || 0)),
      };
    })
    .filter((row): row is PremiumRow => Boolean(row));

  const premium = {
    net: fmtMoney(premiumAmount),
    tax: fmtMoney(mifAmount),
    total: fmtMoney(insuranceTotalAmount),
    insuranceRows: configuredInsuranceRows.length > 0
      ? configuredInsuranceRows
      : [{ itemCode: 'PREMIUM', amount: fmtMoney(premiumAmount) }],
    addOnRows,
  };

  const vehicleUseLimitations = resolveVehicleUseLimitations(qd.vehicleUse);
  const insuredName = firstNonEmpty(policyHolderName(proposer), policyHolder.name, 'Insured');

  // Coverage restriction (ABY-232 / ADR-0025) — drives certificate
  // wording, statement-of-fact driver list, and downstream claims
  // FNOL branching. For pre-ABY-232 policies the value is filled in
  // by `MotorProductAdapter.normalizeQuoteDataForValidation` on read
  // so it should always be present here; the `buildDriversBlock`
  // default branch keeps legacy parity if not.
  const driverRestrictionValue = qd.driverRestriction;
  const additionalDriverRowsRaw = Array.isArray(qd.additionalDrivers)
    ? (qd.additionalDrivers as unknown[]).map((row) => asRecord(row))
    : [];
  // Named-mode is the only mode that carries additional drivers
  // through to the documents. Open / policyholder-only modes have
  // their lists cleared by the wizard / BO / mapper, but we double-
  // gate here to keep document output deterministic.
  const docAdditionalDrivers =
    driverRestrictionValue === 'NAMED_DRIVERS' ? additionalDriverRowsRaw : [];
  const driversBlock = buildDriversBlock({
    driverRestriction: driverRestrictionValue,
    insuredName,
    additionalDrivers: docAdditionalDrivers,
  });
  const proposerStatementDriver = {
    full_name: insuredName || '—',
    date_of_birth: safeStr(proposer.dateOfBirth) ? fmtDateDMY(safeStr(proposer.dateOfBirth)) : '—',
    license_type: safeStr(qd.licenseType) || '—',
    years_held: safeStr(qd.licenseYears) || '—',
    resident: insuredCountry || '—',
    occupation: safeStr(proposer.occupation) || '—',
    relationship: 'Proposer',
    frequency: '—',
    use_other_vehicle: '—',
  };
  const statementAdditionalDrivers = docAdditionalDrivers.map((driver) => ({
    full_name: [safeStr(driver.firstName), safeStr(driver.lastName)].filter(Boolean).join(' ').trim() || '—',
    date_of_birth: safeStr(driver.dateOfBirth) ? fmtDateDMY(safeStr(driver.dateOfBirth)) : '—',
    license_type: safeStr(driver.licenseType) || '—',
    years_held: safeStr(driver.licenseYears) || '—',
    resident: insuredCountry || '—',
    occupation: safeStr(driver.occupation) || '—',
    relationship: 'Additional driver',
    frequency: '—',
    use_other_vehicle: '—',
  }));
  const statementDrivers = [proposerStatementDriver, ...statementAdditionalDrivers];

  return {
    brand,
    policy_number: safeStr(policy.policyNumber),
    certificate_number: safeStr(snap.certificateNumber || policy.certificateNumber),
    binder_ref: safeStr(binder.agreementNumber || ''),
    umr: safeStr(policy.umr || binder.umr || snap.umr || ''),
    period: {
      from: fmtDate(inceptionDate),
      to: fmtDate(expiryDate),
      from_date_only: fmtDateDMY(inceptionDate),
      to_date_only: fmtDateDMY(expiryDate),
      from_full: `${fmtDateDMY(inceptionDate)} at 00:01`,
      to_full: `${fmtDateDMY(expiryDate)} at noon`,
    },
    insured: {
      name: insuredName,
      additionalPolicyHolders,
      address: insuredAddressObj,
      address_one_line: [
        safeStr(proposerAddress.line1),
        safeStr(proposerAddress.city),
        safeStr(proposerAddress.postcode),
        insuredCountry,
      ]
        .filter(Boolean)
        .join(', '),
      address_multiline: [
        safeStr(proposerAddress.line1),
        safeStr(proposerAddress.city),
        safeStr(proposerAddress.province),
        insuredCountry,
        safeStr(proposerAddress.postcode),
      ]
        .filter(Boolean)
        .join('\n'),
      contact: {
        email: safeStr(proposer.email),
        phone: safeStr(proposer.phone),
      },
      occupation: safeStr(proposer.occupation) || '—',
      identity_card_number: policyholderIdentityNumber || '—',
      identity_number: policyholderIdentityNumber || '—',
    },
    vehicles,
    vehicle: vehicle0,
    coverages,
    endorsements,
    scheduleNotes,
    conditions,
    assistance,
    premium,
    premiumBreakdown,
    totals: {
      schedule_total_eur: fmtMoney(insuranceTotalAmount),
      assistance_total_eur: fmtMoney(assistancePremiumEur),
      add_ons_total_eur: fmtMoney(addOnsTotalAmount),
      total_payable_eur: fmtMoney(grandTotalAmount),
      total_paid_to_mga_eur: fmtMoney(totalPaidToAbbeygateEur),
    },
    limitations: {
      use_text: vehicleUseLimitations.useText,
      excluding_text: vehicleUseLimitations.excludingText,
    },
    drivers: driversBlock,
    schedule: {
      reason_for_issue: reasonForIssue,
      policy_wording_form:
        normalizedMbeCfg?.policyWordingForm ||
        normalizedMbeCfg?.wordingForm ||
        docConfig.wordingReference,
      location_label: docConfig.locationLabel,
      roadside_assistance_label: docConfig.roadsideAssistanceLabel,
      legal_assistance_label: docConfig.legalAssistanceLabel,
    },
    statement: {
      broker_address_multiline: safeStr(brand?.brokerAddressMultiline),
      additionalPolicyHolders,
      date_of_birth: safeStr(proposer.dateOfBirth) ? fmtDateDMY(safeStr(proposer.dateOfBirth)) : '—',
      claims_declared: qd.hasClaims === true ? 'Yes' : qd.hasClaims === false ? 'No' : '—',
      claims_details: safeStr(qd.claimsDetails),
      convictions_declared: qd.hasConvictions === true ? 'Yes' : qd.hasConvictions === false ? 'No' : '—',
      convictions_details: safeStr(qd.convictionsDetails),
      other_drivers_claims_declared: qd.otherDriversClaims === true ? 'Yes' : qd.otherDriversClaims === false ? 'No' : '—',
      other_drivers_claims_details: safeStr(qd.otherDriversClaimsDetails),
      other_drivers_convictions_declared: qd.otherDriversConvictions === true ? 'Yes' : qd.otherDriversConvictions === false ? 'No' : '—',
      other_drivers_convictions_details: safeStr(qd.otherDriversConvictionsDetails),
      insurance_refusal_declared: 'No',
      cover_level: safeStr(qd.coverRequired) || '—',
      vehicle_use: safeStr(qd.vehicleUse) || '—',
      excess: safeStr(qd.requiredExcess) || '—',
      ncb: safeStr(qd.ncb) || '—',
      kms_per_year: safeStr(qd.kmsPerYear) || '—',
      drivers: statementDrivers,
    },
    greenCard: {
      authority: safeStr(brand?.greenCardAuthority),
      valid_from: fmtDateDMY(inceptionDate),
      valid_to: fmtDateDMY(expiryDate),
      insurer_code: safeStr(greenCardConfig?.insurerCode),
      serial: safeStr(greenCardSerial),
      code_line: `${safeStr(greenCardConfig?.codePrefix)}/${safeStr(greenCardConfig?.insurerCode)}/${safeStr(greenCardSerial)}-${safeStr(policy.policyNumber)}`,
      vehicle_category: 'A',
      territory_wording: safeStr(greenCardConfig?.territoryWording),
      territory_codes: [
        'A', 'B', 'BG', 'CY', 'CZ', 'D', 'DK', 'E', 'EST', 'F', 'FIN', 'GR', 'H', 'HR', 'I', 'IRL', 'IS', 'L', 'LT',
        'LV', 'M', 'N', 'NL', 'P', 'PL', 'RO', 'S', 'SK', 'SLO', 'CH', 'GB',
      ],
      territories: (() => {
        const allowed = new Set(
          [
            'A', 'B', 'BG', 'CY', 'CZ', 'D', 'DK', 'E', 'EST', 'F', 'FIN', 'GR', 'H', 'HR', 'I', 'IRL', 'IS', 'L',
            'LT', 'LV', 'M', 'N', 'NL', 'P', 'PL', 'RO', 'S', 'SK', 'SLO', 'CH', 'GB',
          ].map(String)
        );
        return GREEN_CARD_ALL_TERRITORY_CODES.map((code) => ({
          code,
          crossed: !allowed.has(code),
        }));
      })(),
      issuer_name: safeStr(brand?.greenCardIssuerName),
      issuer_address: safeStr(brand?.greenCardIssuerAddress),
      signature_asset: safeStr(brand?.uwSignatureAsset),
    },
    lloyds: {
      registration_no: '800353965',
    },
    quoteReference: safeStr(qr.reference || ''),
    generatedAt: new Date().toISOString(),
    generatedDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }), // DD/MM/YYYY
    basePath: assetsBasePath,
  };
}
