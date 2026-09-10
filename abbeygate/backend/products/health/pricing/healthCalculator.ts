import type { PremiumCalculation } from '../../../platform/types/index.js';
import type { CalculationStep } from '../../../platform/types/pricing.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { resolveJurisdictionProductConfig } from '../../../modules/jurisdiction/domain/productConfiguration.js';
import {
  loadBritHealthRates,
  lookupHealthAgeBandRow,
  resolveHealthAgeBand,
  type HealthAgeBand,
} from './data/loader.js';

/**
 * BRIT Immigration Medical Insurance calculator.
 *
 * Premium model is age-banded per insured (sum-of-band-rates for
 * multi-insured policies). Excess varies by age band per the rate JSON
 * — the schedule renders the excess column from the same loader, never
 * inline.
 *
 * GHS extension adds outpatient + repatriation cover at no premium
 * impact — the bonus rides on whether `ghs.isBeneficiary === true` and
 * is reflected in the document view-model, not the calculator total.
 *
 * IPT is resolved via the `CY_HEALTH_BRIT_BAA_2026` tax profile. CY
 * medical is assumed exempt (€0 IPT) until Peter confirms otherwise —
 * if a future change adds a positive rate, it lives in the profile
 * resolver, never inline in this file.
 *
 * Admin fee is currently €0 (no banded fee structure for HEALTH Phase 1).
 * If Peter introduces a banded admin fee later, add `health-fee-bands.json`
 * mirroring travel's pattern.
 */

export class HealthQuoteValidationError extends Error {
  readonly code: 'INVALID_DOB' | 'INVALID_PERIOD' | 'NO_INSUREDS';
  constructor(code: 'INVALID_DOB' | 'INVALID_PERIOD' | 'NO_INSUREDS', message: string) {
    super(message);
    this.name = 'HealthQuoteValidationError';
    this.code = code;
  }
}

export const HEALTH_CALCULATOR_VERSION = 'health@1.0.0';

export interface HealthInsuredPerson {
  firstName?: string;
  lastName?: string;
  dob?: string;
  gender?: string;
  idNumber?: string;
  occupation?: string;
  email?: string;
  phone?: string;
}

export interface HealthQuoteData {
  eligibility?: {
    countryOfResidence?: string;
    /** Derived UW outcome (ADR-0025 pattern). Not a customer input. */
    isExpat?: boolean;
    nationality?: string;
    hasOtherNationality?: boolean;
    otherNationality?: string;
    residenceDuration?: 'lt_1_year' | '1_3_years' | 'gt_3_years';
    residencyStatus?: 'permanent_resident' | 'temporary_resident' | 'work_visa' | 'student_visa' | 'visitor' | 'other_visa';
    willRemainResident?: boolean;
    legallyPermittedToReside?: boolean;
    informationAccurate?: boolean;
    legalAgreement?: boolean;
  };
  insureds?: {
    coverType?: string;
    personCount?: number;
    persons?: HealthInsuredPerson[];
  };
  period?: {
    inceptionDate?: string;
    expiryDate?: string;
  };
  ghs?: { isBeneficiary?: boolean };
  proposer?: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    gender?: string;
    idType?: string;
    idNumber?: string;
    occupation?: string;
    email?: string;
    phone?: string;
    address?: { line1?: string; line2?: string; city?: string; postcode?: string; country?: string };
  };
}

export type HealthBreakdownLineKind = 'base' | 'addon' | 'tax' | 'fee' | 'total';

export interface HealthBreakdownLine {
  code: string;
  label: string;
  amount: number;
  kind: HealthBreakdownLineKind;
}

export interface HealthInsuredPriced {
  index: number;
  firstName: string;
  lastName: string;
  age: number;
  ageBand: HealthAgeBand;
  grossPremium: number;
  excess: number | '10%';
}

export interface HealthBreakdown {
  basePremium: number;
  netPremium: number;
  commissionAmount: number;
  iptAmount: number;
  adminFee: number;
  grossPremium: number;
  /** Per-insured priced rows — drives schedule rendering of age + excess. */
  insureds: HealthInsuredPriced[];
  /** Canonical ordered breakdown lines (wizard sidebar + BO Premium + PDF). */
  lines: HealthBreakdownLine[];
  /** True when GHS extension applies (no premium impact, schedule renders extended block). */
  ghsExtensionApplied: boolean;
}

function ageFromDOB(dob: string, atIso?: string): number {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) {
    throw new HealthQuoteValidationError(
      'INVALID_DOB',
      `Invalid insured date of birth: '${String(dob || '')}'.`,
    );
  }
  const ref = atIso ? new Date(atIso) : new Date();
  if (Number.isNaN(ref.getTime())) {
    throw new HealthQuoteValidationError(
      'INVALID_PERIOD',
      `Invalid policy inception date: '${String(atIso || '')}'.`,
    );
  }
  let age = ref.getFullYear() - d.getFullYear();
  const m = ref.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < d.getDate())) age -= 1;
  return age;
}

function collectInsuredDobs(data: HealthQuoteData): Array<{ index: number; firstName: string; lastName: string; dob: string }> {
  const persons = Array.isArray(data.insureds?.persons) ? data.insureds!.persons! : [];
  return persons
    .map((person, index) => ({
      index,
      firstName: String(person?.firstName || '').trim(),
      lastName: String(person?.lastName || '').trim(),
      dob: String(person?.dob || '').trim(),
    }))
    .filter((row) => row.dob.length > 0);
}

function zeroBreakdown(): HealthBreakdown {
  return {
    basePremium: 0,
    netPremium: 0,
    commissionAmount: 0,
    iptAmount: 0,
    adminFee: 0,
    grossPremium: 0,
    insureds: [],
    lines: [],
    ghsExtensionApplied: false,
  };
}

/**
 * Calculate a HEALTH premium against the canonical BRIT rate card.
 * Per ADR-0031, `breakdown.lines` is the canonical ordered display
 * sequence consumed by Wizard sidebar, BO Premium tab and PDF schedule.
 */
export function calculateHealthPremium(data: HealthQuoteData): {
  premium: PremiumCalculation;
  breakdown: HealthBreakdown;
  refer: boolean;
  reason?: string;
  declined: boolean;
  declineReason?: string;
} {
  const tenant = getTenantConfig();
  const jurisdictionConfig = resolveJurisdictionProductConfig({
    productCode: 'HEALTH',
    tenant,
  });

  const insuredsRaw = collectInsuredDobs(data);
  if (insuredsRaw.length === 0) {
    throw new HealthQuoteValidationError(
      'NO_INSUREDS',
      'At least one insured person with a date of birth is required to calculate a HEALTH premium.',
    );
  }

  const inception = data.period?.inceptionDate || undefined;
  const insuredPriced: HealthInsuredPriced[] = [];
  const steps: CalculationStep[] = [];
  const lines: HealthBreakdownLine[] = [];

  let basePremium = 0;
  let commissionAmount = 0;

  for (const row of insuredsRaw) {
    const age = ageFromDOB(row.dob, inception);
    const band = resolveHealthAgeBand(age);
    if (!band) {
      return {
        premium: {
          premium: 0, basis: 'HYBRID',
          calculationDetails: {
            steps: [{ id: 'health.refer.ageBand', name: 'Refer: invalid age band', kind: 'total', output: 0, inputs: { age, insuredIndex: row.index } }],
            calculatorVersion: HEALTH_CALCULATOR_VERSION,
          },
        },
        breakdown: zeroBreakdown(),
        refer: true,
        reason: `Insured #${row.index + 1} age ${age} could not be mapped to an age band`,
        declined: false,
      };
    }
    const bandRow = lookupHealthAgeBandRow(band);
    if (!bandRow) {
      return {
        premium: {
          premium: 0, basis: 'HYBRID',
          calculationDetails: {
            steps: [{ id: 'health.refer.noRate', name: 'Refer: no rate row for band', kind: 'total', output: 0, inputs: { band } }],
            calculatorVersion: HEALTH_CALCULATOR_VERSION,
          },
        },
        breakdown: zeroBreakdown(),
        refer: true,
        reason: `No rate row defined for age band '${band}'`,
        declined: false,
      };
    }
    const grossForInsured = Number(bandRow.premiumGross.toFixed(2));
    const commissionForInsured = Number((bandRow.premiumGross * bandRow.commissionPercent).toFixed(2));
    insuredPriced.push({
      index: row.index,
      firstName: row.firstName,
      lastName: row.lastName,
      age,
      ageBand: band,
      grossPremium: grossForInsured,
      excess: bandRow.excess,
    });
    basePremium += grossForInsured;
    commissionAmount += commissionForInsured;
    const labelParts = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
    const insuredLabel = labelParts ? `${labelParts} (age ${age})` : `Insured #${row.index + 1} (age ${age})`;
    steps.push({
      id: `health.base.${row.index}`,
      name: `Premium — ${insuredLabel}`,
      kind: 'table_lookup',
      inputs: { age, band, grossPerInsured: grossForInsured, commissionPercent: bandRow.commissionPercent, excess: bandRow.excess },
      output: grossForInsured,
    });
    lines.push({ code: `base.insured.${row.index}`, label: `Premium — ${insuredLabel}`, amount: grossForInsured, kind: 'base' });
  }

  basePremium = Number(basePremium.toFixed(2));
  commissionAmount = Number(commissionAmount.toFixed(2));
  const netPremium = Number((basePremium - commissionAmount).toFixed(2));
  steps.push({ id: 'health.netPremium', name: 'Net premium (after commission)', kind: 'subtotal', output: netPremium });

  // CY health IPT assumption: exempt (€0) until Peter confirms otherwise.
  // If the profile resolver returns a non-zero rate in future the line
  // would be emitted here — no inline branching.
  const iptAmount = 0;
  steps.push({ id: 'health.tax.ipt', name: 'Insurance premium tax', kind: 'tax', amount: iptAmount, inputs: { country: jurisdictionConfig.countryCode, profile: jurisdictionConfig.taxRegime.profileCode } });

  // Admin fee — €0 in Phase 1; if Peter introduces a banded admin fee
  // it will live in `data/health-fee-bands.json` mirroring travel.
  const adminFee = 0;
  if (adminFee > 0) {
    steps.push({ id: 'health.fee.admin', name: 'Admin fee', kind: 'fee', amount: adminFee });
  }

  const grossPremium = Number((basePremium + iptAmount + adminFee).toFixed(2));
  steps.push({ id: 'health.grossPremium', name: 'Total', kind: 'total', output: grossPremium });

  if (iptAmount > 0) {
    lines.push({ code: 'tax.ipt', label: 'Insurance premium tax', amount: iptAmount, kind: 'tax' });
  }
  if (adminFee > 0) {
    lines.push({ code: 'fee.admin', label: 'Admin fee', amount: adminFee, kind: 'fee' });
  }
  lines.push({ code: 'total', label: 'Total', amount: grossPremium, kind: 'total' });

  const ghsExtensionApplied = data.ghs?.isBeneficiary === true;
  const rates = loadBritHealthRates();
  if (ghsExtensionApplied) {
    steps.push({
      id: 'health.ghs.extension',
      name: 'GESY extension — outpatient + repatriation (no premium impact)',
      kind: 'fee',
      amount: 0,
      inputs: { outpatientPerIllness: rates.ghsExtension.outpatientPerIllness, coinsurancePercent: rates.ghsExtension.coinsurancePercent },
    });
  }

  return {
    premium: {
      premium: grossPremium,
      basis: 'HYBRID',
      calculationDetails: {
        fixedAmount: grossPremium,
        proRataFactor: 1,
        steps,
        calculatorVersion: HEALTH_CALCULATOR_VERSION,
      },
    },
    breakdown: {
      basePremium,
      netPremium,
      commissionAmount,
      iptAmount,
      adminFee,
      grossPremium,
      insureds: insuredPriced,
      lines,
      ghsExtensionApplied,
    },
    refer: false,
    declined: false,
  };
}
