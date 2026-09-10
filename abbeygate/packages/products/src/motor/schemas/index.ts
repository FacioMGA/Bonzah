/**
 * Motor wizard validation schemas — canonical Zod tree.
 *
 * Phase 8 (2026-04-28) absorption: previously lived at
 * `frontend/src/products/motor/wizard/schemas/`. Moved into the
 * package so motor's profile imports them directly (no IoC seam) and
 * BE/FE consumers share one Zod source. The only previous FE coupling
 * was `react-phone-number-input`'s `isPossiblePhoneNumber` — replaced
 * here with the framework-agnostic `libphonenumber-js`.
 */
import type { ZodTypeAny } from 'zod';
import { z } from 'zod';
import { Step1Schema } from './step1.js';
import { Step2Schema } from './step2.js';
import { Step3Schema } from './step3.js';

export { Step1Schema, Step2Schema, Step3Schema };

// Zod v4 rejects `.merge()` once any participating object carries refinements.
// Intersections preserve the per-step refinement rules without re-declaring the shapes.
export const QuoteSchema = z.intersection(z.intersection(Step1Schema, Step2Schema), Step3Schema);

export type QuoteDataFromSchema = z.infer<typeof QuoteSchema>;

/**
 * Field-name → human label map used to construct friendly fallback
 * messages when a Zod issue carries a generic message such as "Invalid
 * input" (default for `invalid_union`) or "Expected boolean, received
 * undefined" (default for `invalid_type` against `z.boolean()`).
 *
 * Without this map, an untyped field — e.g. RHF leaves `kmsPerYear` /
 * `modified` undefined on first paint, or a select stub returns the
 * empty string — would surface to the user as the literal "Invalid
 * input" with no clue which field is broken (ABY-50). The wizard uses
 * the field path for highlighting (`error={!!errors[fieldKey]}`), so
 * the highlight WAS being applied; the message is what users actually
 * read in the toast/banner, and "Invalid input" is unactionable.
 */
const FIELD_LABELS: Record<string, string> = {
  // Step 1 (proposer / policyholder)
  'proposer.firstName': 'First name',
  'proposer.lastName': 'Last name',
  'proposer.dateOfBirth': 'Date of birth',
  'proposer.email': 'Email',
  'proposer.phone': 'Phone',
  'proposer.nationality': 'Nationality',
  'proposer.nif': 'NIF / tax ID',
  'proposer.occupation': 'Occupation',
  'proposer.whereDidYouHear': 'How did you hear about us',
  'proposer.bestTimeToCall': 'Best time to call',
  'proposer.privacyPolicyAccepted': 'Privacy policy acceptance',
  'proposer.address.line1': 'Address line 1',
  'proposer.address.city': 'City',
  'proposer.address.province': 'Province',
  'proposer.address.postcode': 'Postcode',
  'proposer.address.country': 'Country',
  // Step 2 (driving history)
  licenseYears: 'Licence years',
  claimsCountLast5Years: 'Claims in last 5 years',
  claimsTotalCostLast5Years: 'Total claim cost in last 5 years',
  maxFaultClaimCostLast5Years: 'Max fault claim cost in last 5 years',
  majorConvictionWithinYears: 'Years since major conviction',
  youngestDriverAge: 'Youngest driver age',
  // Step 3 (vehicle + cover)
  vehicleLocation: 'Where the vehicle is kept',
  countryOfRegistration: 'Country of registration',
  registrationNumber: 'Registration number',
  vin: 'VIN',
  coverRequired: 'Cover type',
  renewalDate: 'Renewal date',
  vehicleType: 'Vehicle type',
  motorcycleRidersNamed: 'Motorcycle riders',
  classicIsGenuine: 'Genuine classic confirmation',
  classicIsSecondaryVehicle: 'Secondary vehicle confirmation',
  make: 'Vehicle make',
  model: 'Vehicle model',
  cabrio: 'Cabrio',
  parking: 'Parking location',
  parkingOther: 'Parking location (other)',
  fuelType: 'Fuel type',
  kmsPerYear: 'Annual kilometres',
  year: 'Vehicle year',
  numberOfSeats: 'Number of seats',
  modified: 'Vehicle modified status',
  modificationsDetails: 'Modifications details',
  engineSize: 'Engine size',
  vehicleValue: 'Vehicle value',
  ncb: 'No Claims Bonus',
  vehicleUse: 'Vehicle use',
  requiredExcess: 'Excess',
  ncdProofUpload: 'NCD proof upload',
  infoTrueAndAccurate: 'Information is true and accurate (declaration)',
  fairProcessingAccepted: 'Fair processing acceptance (declaration)',
  additionalDrivers: 'Additional drivers',
};

function labelForFieldKey(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  // Strip array indices: `additionalDrivers.0.firstName` →
  // `additionalDrivers.firstName` for label lookup, then fall back to
  // the last segment as a humanised string.
  const noIndex = key.replace(/\.\d+\./g, '.');
  if (FIELD_LABELS[noIndex]) return FIELD_LABELS[noIndex];
  const tail = key.split('.').pop() || key;
  if (FIELD_LABELS[tail]) return FIELD_LABELS[tail];
  return tail
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

const ZOD_DEFAULT_MESSAGE_PREFIXES = [
  'Invalid input',
  'Required',
  'Expected ',
  'Invalid value',
  'Invalid type',
];

function isUnactionableZodMessage(message: string): boolean {
  const trimmed = String(message || '').trim();
  if (!trimmed) return true;
  return ZOD_DEFAULT_MESSAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function friendlyMessageForZodIssue(issue: z.ZodIssue, key: string): string {
  const original = String(issue.message || '').trim();
  if (!isUnactionableZodMessage(original)) return original;
  const label = labelForFieldKey(key);
  // The canonical "missing field" path on a freshly-rehydrated
  // wizard surfaces as `invalid_type` with the original message
  // mentioning `received undefined` / `received null` / `received nothing`.
  // For those, ask the user to complete the field. For any other
  // unactionable Zod default ("Invalid input", "Invalid input: expected
  // number, received string", `invalid_union` defaults, etc.) tell
  // them their value is not valid for the named field — never let the
  // bare "Invalid input" reach the UI without a field label (ABY-50).
  const lowerMessage = original.toLowerCase();
  const looksMissing =
    lowerMessage.includes('received undefined')
    || lowerMessage.includes('received null')
    || lowerMessage.includes('received nothing');
  if (looksMissing) return `Please complete the ${label} field`;
  return `Please enter a valid value for ${label}`;
}

export function zodErrorsToFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const segments = (issue.path || []).map((segment) => String(segment));
    const key = segments.length > 0 ? segments.join('.') : 'form';
    if (!out[key]) out[key] = friendlyMessageForZodIssue(issue, key);
  }
  return out;
}

function validateWithSchema(schema: ZodTypeAny, data: unknown): Record<string, string> {
  const parsed = schema.safeParse(data);
  return parsed.success ? {} : zodErrorsToFieldErrors(parsed.error);
}

/**
 * Wizard-form coercion: react-hook-form initial state and select onChange
 * payloads use empty strings as "no value yet". The canonical Phase-8
 * schemas are strict about `z.number()`, so before validating we coerce
 * empty strings to `undefined` for the known numeric fields. Real string
 * values that should be numbers (e.g. `'10000'`) still fail strict
 * parsing — that is intentional; upstream form code is responsible for
 * `setValueAs: Number` on numeric inputs.
 */
const NUMERIC_WIZARD_FIELDS = [
  // Step 2
  'licenseYears', 'claimsCountLast5Years', 'claimsTotalCostLast5Years',
  'maxFaultClaimCostLast5Years', 'majorConvictionWithinYears', 'youngestDriverAge',
  // Step 3 — `kmsPerYear` deliberately excluded: it is a formatted
  // string field (e.g. `'10,000'`) per Step3VehicleCover.tsx + canonicalRules.ts.
  'year', 'numberOfSeats', 'engineSize', 'vehicleValue',
] as const;

function coerceEmptyStringsToUndefined(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const key of NUMERIC_WIZARD_FIELDS) {
    if (out[key] === '') out[key] = undefined;
  }
  return out;
}

export function validateWizardPolicyHolderStep(data: unknown): Record<string, string> {
  return validateWithSchema(Step1Schema, coerceEmptyStringsToUndefined(data));
}

export function validateWizardDrivingHistoryStep(data: unknown): Record<string, string> {
  return validateWithSchema(Step2Schema, coerceEmptyStringsToUndefined(data));
}

export function validateWizardVehicleCoverStep(data: unknown): Record<string, string> {
  return validateWithSchema(Step3Schema, coerceEmptyStringsToUndefined(data));
}

/**
 * Lifecycle-stage refinements absorbed from the deleted
 * `validateUnifiedQuoteData.collectSemanticIssues`.
 *
 * Stage validation is *narrower* than wizard-step validation: at bind
 * and issuance we only verify the canonical bind/issuance shape (DOB
 * ≥ 18, license-years ≤ age-17, renewalDate within 45 days, additional
 * drivers complete, VIN well-formed). The strict per-step Zod tree
 * (Step1 + Step2 + Step3, including kmsPerYear range, parking,
 * numberOfSeats, modified, …) stays scoped to the wizard step
 * refinements where the customer is still answering questions; at
 * issuance the canonical fixtures and BO-only mutations don't have to
 * carry every wizard field.
 *
 * `validateMotorIssuanceStage` adds the registration-or-vin gate.
 */
function isBlankString(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length === 0 : value === null || value === undefined;
}

function readPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object') return undefined;
  const segments = path.split('.');
  let current: unknown = source;
  for (const segment of segments) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function ageFromDob(rawDob: string): number | null {
  const dob = new Date(rawDob);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
}

/**
 * Driver coverage restriction (ABY-232 / ADR-0025).
 *
 *   POLICYHOLDER_ONLY    — only the proposer may drive (named basis, no rows)
 *   NAMED_DRIVERS        — proposer + named additional drivers (named basis)
 *   ANY_DRIVER_25_PLUS   — open authorised drivers, ages 25–70
 *   ANY_DRIVER_40_PLUS   — open authorised drivers, ages 40–70
 */
export type DriverRestriction =
  | 'POLICYHOLDER_ONLY'
  | 'NAMED_DRIVERS'
  | 'ANY_DRIVER_25_PLUS'
  | 'ANY_DRIVER_40_PLUS';

export const DRIVER_RESTRICTION_VALUES: readonly DriverRestriction[] = [
  'POLICYHOLDER_ONLY',
  'NAMED_DRIVERS',
  'ANY_DRIVER_25_PLUS',
  'ANY_DRIVER_40_PLUS',
];

/**
 * Returns the minimum permitted driver age for open coverage modes.
 * Named modes (POLICYHOLDER_ONLY / NAMED_DRIVERS) return `null` —
 * the proposer / named-driver age is governed by the proposer DOB
 * rules and the per-row driver checks, not by a blanket open-driver
 * threshold.
 */
export function driverRestrictionMinAge(restriction: unknown): number | null {
  if (restriction === 'ANY_DRIVER_25_PLUS') return 25;
  if (restriction === 'ANY_DRIVER_40_PLUS') return 40;
  return null;
}

function validateAdditionalDriverArray(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  // Coverage-restriction gating (ABY-232): the named-drivers list is
  // only meaningful when `driverRestriction === 'NAMED_DRIVERS'`. In
  // every other mode the wizard / BO controllers cascade-clear the
  // array and the boolean, and validation must not block on stale
  // values. (See ADR-0025 and the validation-runtime contract lock
  // "additionalDrivers must not block quote rating when
  // driverRestriction !== NAMED_DRIVERS".)
  const restriction = data.driverRestriction;
  if (restriction && restriction !== 'NAMED_DRIVERS') return out;
  if (data.hasAdditionalDrivers !== true) return out;
  const drivers = Array.isArray(data.additionalDrivers) ? data.additionalDrivers : [];
  if (drivers.length === 0) {
    out['additionalDrivers'] = 'additionalDrivers must include at least one driver when hasAdditionalDrivers=true';
    return out;
  }
  drivers.forEach((entry, idx) => {
    const driver = (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}) as Record<string, unknown>;
    if (isBlankString(driver.firstName)) out[`additionalDrivers.${idx}.firstName`] = 'Additional driver firstName is required';
    if (isBlankString(driver.lastName)) out[`additionalDrivers.${idx}.lastName`] = 'Additional driver lastName is required';
    if (isBlankString(driver.dateOfBirth)) out[`additionalDrivers.${idx}.dateOfBirth`] = 'Additional driver dateOfBirth is required';
    if (driver.licenseYears === undefined || driver.licenseYears === null || driver.licenseYears === '') {
      out[`additionalDrivers.${idx}.licenseYears`] = 'Additional driver licenseYears is required';
    }
  });
  return out;
}

function validateMotorStageSemantics(data: unknown): Record<string, string> {
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};

  // Coverage restriction (ABY-232) — required at bind / issuance. The
  // legacy back-compat derivation in `MotorProductAdapter` fills this
  // for pre-ABY-232 quotes from `hasAdditionalDrivers`, so any
  // missing value here is a contract violation, not a data-shape
  // tolerance question.
  const restriction = obj.driverRestriction;
  if (restriction === undefined || restriction === null || restriction === '') {
    errors['driverRestriction'] = 'driverRestriction is required (POLICYHOLDER_ONLY | NAMED_DRIVERS | ANY_DRIVER_25_PLUS | ANY_DRIVER_40_PLUS)';
  } else if (
    restriction !== 'POLICYHOLDER_ONLY'
    && restriction !== 'NAMED_DRIVERS'
    && restriction !== 'ANY_DRIVER_25_PLUS'
    && restriction !== 'ANY_DRIVER_40_PLUS'
  ) {
    errors['driverRestriction'] = `driverRestriction value '${String(restriction)}' is not one of the allowed coverage modes`;
  }

  const dobRaw = String(readPath(obj, 'proposer.dateOfBirth') || '').trim();
  if (dobRaw) {
    const age = ageFromDob(dobRaw);
    if (age === null) {
      errors['proposer.dateOfBirth'] = 'dateOfBirth must be a valid date';
    } else {
      if (age < 18) errors['proposer.dateOfBirth'] = 'Driver must be at least 18 years old';
      const licenseYears = Number(obj.licenseYears);
      if (Number.isFinite(licenseYears) && licenseYears > age - 17) {
        errors['licenseYears'] = 'licenseYears cannot exceed driving age since 17';
      }
    }
  }

  const renewalDateRaw = String(obj.renewalDate || '').trim();
  if (renewalDateRaw) {
    const renewal = new Date(renewalDateRaw);
    if (Number.isNaN(renewal.getTime())) {
      errors['renewalDate'] = 'renewalDate must be a valid date';
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const renewalDateOnly = new Date(renewal);
      renewalDateOnly.setHours(0, 0, 0, 0);
      const maxDate = new Date(today);
      maxDate.setDate(maxDate.getDate() + 45);
      if (renewalDateOnly < today) errors['renewalDate'] = 'renewalDate must be today or later';
      else if (renewalDateOnly > maxDate) errors['renewalDate'] = 'renewalDate must be within 45 days';
    }
  }

  const vin = String(obj.vin || '').trim().toUpperCase();
  if (vin) {
    const vinPattern = /^[A-HJ-NPR-Z0-9]{11,17}$/;
    if (!vinPattern.test(vin)) {
      errors['vin'] = 'vin must be 11-17 characters and cannot contain I, O, or Q';
    }
  }

  return { ...errors, ...validateAdditionalDriverArray(obj) };
}

export function validateMotorBindStage(data: unknown): Record<string, string> {
  return validateMotorStageSemantics(data);
}

export function validateMotorIssuanceStage(data: unknown): Record<string, string> {
  const errors = validateMotorStageSemantics(data);
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const reg = String(obj.registrationNumber || '').trim();
  const vin = String(obj.vin || '').trim();
  if (!reg && !vin) {
    // ABY-104 — surface ONE message that explicitly says "either or".
    // The previous shape attached an error to BOTH fields with two
    // different messages, so the wizard's per-field error renderer
    // showed two red banners that read like two independent
    // requirements — exactly the "validates on both" report. We pin
    // the message on `registrationNumber` (the canonical primary
    // identifier per Step3VehicleIdentitySection's default mode) and
    // mirror a short pointer onto `vin` so the wizard's
    // QuoteWizardErrorSummary still highlights both fields, but the
    // human-readable copy makes the OR semantics unambiguous.
    errors['registrationNumber'] = 'Provide either Registration number OR VIN — only one is required to issue.';
    errors['vin'] = 'Provide either Registration number OR VIN — only one is required to issue.';
  }
  return errors;
}
