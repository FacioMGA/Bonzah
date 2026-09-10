/**
 * quoteDataGuards.ts — Pure validation, filtering, and sanitization for public auto quote data.
 *
 * This module contains ONLY pure functions — no Prisma, no side effects, no logging.
 * It owns:
 *   - Step-scoped field allowlists (STEP_SCOPED_FIELDS)
 *   - Patch filtering by wizard step
 *   - Issue-details non-clobber field preservation
 *   - Additional driver sanitization
 *   - Start-date window validation
 *   - Shared helper utilities (asRecord, asBool, etc.)
 */
import type { AdditionalDriver, QuoteData } from '../../../platform/types/autoInsurance.js';
import { MOTOR_STEP_SCOPED_FIELDS } from '@facio/products';
import { vehicleEnrichmentNormalization } from '../../../modules/vehicles/app/vehicleEnrichmentService.js';
import { deepMergePlain, isPlainObject, type QuoteDataObject } from '../../../shared/lib/deepMerge.js';

type ErrorsModule = typeof import('./errors.js');
const errorsModule: ErrorsModule = await import('./errors.js');
const { PublicApiError } = errorsModule;

export type UnknownRecord = Record<string, unknown>;

const POLICY_START_MAX_DAYS_AHEAD = 45;

// ── Shared utilities ──────────────────────────────────────────────

export function asRecord(value: unknown): UnknownRecord {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

export function asBool(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function hasNonEmptyValue(value: unknown): boolean {
    return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

export function quoteDataToRecord(quoteData: QuoteData): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(quoteData)) out[k] = v;
    return out;
}

// ── Step-scoped field allowlists ──────────────────────────────────
// Derived from generated questionnaire contract artifacts.
//
// Phase 6k canonical shape: `MOTOR_STEP_SCOPED_FIELDS` uses dotted
// paths (e.g. `'proposer.firstName'`). Patches arrive nested
// (`{ proposer: { firstName: '…' } }`) so the per-step filter matches
// the *top-level key* against any allowed dotted path that starts
// with that key. This collapses the entire `proposer` sub-tree into
// a single allow/deny decision per step.
export const STEP_SCOPED_FIELDS: Record<string, ReadonlySet<string>> = Object.fromEntries(
    Object.entries(MOTOR_STEP_SCOPED_FIELDS).map(([stepKey, fields]) => [stepKey, new Set<string>(fields)])
) as Record<string, ReadonlySet<string>>;

export const ALWAYS_ALLOWED_PATCH_KEYS = new Set([
    '__meta',
    '__followUpRequests',
    '__followUpAnswers',
    'uwAdjustment',
    'uwAdjustments',
]);

/**
 * Issue-details non-clobber paths (Phase 6k canonical shape). Each
 * entry is a dotted path into the canonical motor `quoteData`. The
 * preserve helper walks each path, and if the incoming value is
 * blank but the previous value is non-blank, drops the incoming
 * blank to avoid wiping issuance-critical data the customer already
 * entered.
 */
export const ISSUE_DETAILS_NON_CLOBBER_PATHS = [
    'proposer.firstName',
    'proposer.lastName',
    'proposer.email',
    'proposer.phone',
    'proposer.dateOfBirth',
    'proposer.address.line1',
    'proposer.address.city',
    'proposer.address.province',
    'proposer.address.postcode',
    'proposer.address.country',
    'proposer.domicileCountry',
    'proposer.occupation',
    'proposer.whereDidYouHear',
    'licenseYears',
    'licenseType',
    // ABY-346 — the vehicle identity entered earlier in the wizard must
    // survive an issue-details patch that arrives without it. Without
    // these the issue-details step re-prompted the customer for a
    // registration / VIN they had already supplied.
    'registrationNumber',
    'vin',
    // ABY-338 — issue-details can carry the full vehicle-cover shape.
    // Blank defaults must not erase values the policyholder already gave.
    'vehicleValue',
    'garageTotalValue',
] as const;

/**
 * Merge motor draft patches onto the persisted policy column and the
 * current snapshot before applying the incoming wizard/BO payload.
 *
 * ABY-542 — shallow `{ ...prev, ...incoming }` let a later autosave
 * replace the entire `proposer` object when the patch omitted a leaf. A
 * standard nested merge preserves sibling fields, but explicit leaf resets
 * must remain resets (for example, changing make intentionally clears model).
 * The only preserved empty default is proposer DOB on a later wizard step;
 * the policy-holder step remains the sole explicit owner of that reset.
 */
export function mergeMotorDraftQuoteData(
  policyQuoteData: unknown,
  snapshotQuoteData: unknown,
  incomingQuoteData: unknown,
  stepKey: string,
): QuoteDataObject {
  const persisted = deepMergePlain(
    isPlainObject(policyQuoteData) ? policyQuoteData : {},
    isPlainObject(snapshotQuoteData) ? snapshotQuoteData : {},
  );
  const merged = deepMergePlain(
    persisted,
    isPlainObject(incomingQuoteData) ? incomingQuoteData : {},
  ) as QuoteDataObject;
  const incomingProposer = isPlainObject(incomingQuoteData) && isPlainObject(incomingQuoteData.proposer)
    ? incomingQuoteData.proposer
    : null;
  const persistedProposer = isPlainObject(persisted.proposer) ? persisted.proposer : null;

  if (
    stepKey !== 'policy-holder' &&
    incomingProposer?.dateOfBirth === '' &&
    typeof persistedProposer?.dateOfBirth === 'string' &&
    persistedProposer.dateOfBirth.trim()
  ) {
    merged.proposer = {
      ...(isPlainObject(merged.proposer) ? merged.proposer : {}),
      dateOfBirth: persistedProposer.dateOfBirth,
    };
  }

  return merged;
}

// ── Patch filtering ───────────────────────────────────────────────

function topLevelKey(path: string): string {
    const dot = path.indexOf('.');
    return dot < 0 ? path : path.slice(0, dot);
}

export function filterQuoteDataPatchByStep(quoteData: UnknownRecord, stepKey: string): UnknownRecord {
    const allowedStepFields = STEP_SCOPED_FIELDS[stepKey];
    if (!allowedStepFields) return quoteData;
    const allowedTopLevelKeys = new Set<string>();
    for (const path of allowedStepFields) {
        allowedTopLevelKeys.add(topLevelKey(path));
    }
    const out: UnknownRecord = {};
    for (const [k, v] of Object.entries(quoteData)) {
        if (allowedTopLevelKeys.has(k) || ALWAYS_ALLOWED_PATCH_KEYS.has(k)) {
            out[k] = v;
        }
    }
    return out;
}

export function getAtPath(source: UnknownRecord, path: string): unknown {
    const segments = path.split('.');
    let current: unknown = source;
    for (const segment of segments) {
        if (current && typeof current === 'object' && !Array.isArray(current)) {
            current = (current as UnknownRecord)[segment];
        } else {
            return undefined;
        }
    }
    return current;
}

function deleteAtPath(source: UnknownRecord, path: string): UnknownRecord {
    const segments = path.split('.');
    if (segments.length === 1) {
        const next = { ...source };
        delete next[segments[0]!];
        return next;
    }
    const head = segments[0]!;
    const rest = segments.slice(1).join('.');
    const child = source[head];
    if (!child || typeof child !== 'object' || Array.isArray(child)) return source;
    const nextChild = deleteAtPath(child as UnknownRecord, rest);
    return { ...source, [head]: nextChild };
}

export function preserveIssueDetailsNonClobberFields(
    incomingQuoteData: Record<string, unknown>,
    prevQuoteData: Record<string, unknown>
): Record<string, unknown> {
    let next: UnknownRecord = { ...incomingQuoteData };
    for (const path of ISSUE_DETAILS_NON_CLOBBER_PATHS) {
        const incomingValue = getAtPath(next, path);
        const prevValue = getAtPath(prevQuoteData, path);
        const incomingIsBlank = typeof incomingValue === 'string' && incomingValue.trim() === '';
        const prevHasValue = hasNonEmptyValue(prevValue);
        if (incomingIsBlank && prevHasValue) {
            next = deleteAtPath(next, path);
        }
    }
    return next;
}

// ── Motor-specific shape normalizers ──────────────────────────────
//
// Pre-Phase-9 these lived in `motorQuoteDataSchema.ts` alongside a
// parallel Zod tree. Phase 9 (`spine/v2` Wave 2) collapsed every motor
// validation into the canonical `motorValidationProfile` step + stage
// refinements, so the parallel schema was deleted. The normalizers
// stayed motor-only and moved here, the canonical home for "pure
// validation, filtering, and sanitization for public auto quote data".

function isMotorcycleVehicleType(value: unknown): boolean {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized.includes('motorbike') || normalized.includes('motorcycle');
}

export function normalizeMotorcycleNamedRidersOnly<T extends Record<string, unknown>>(quoteData: T): T {
    if (!isMotorcycleVehicleType(quoteData.vehicleType)) return quoteData;
    if (quoteData.motorcycleRidersNamed === true) return quoteData;
    return { ...quoteData, motorcycleRidersNamed: true };
}

export function normalizeBoQuoteDataCompatibility<T extends Record<string, unknown>>(quoteData: T): T {
    const normalized: Record<string, unknown> = { ...quoteData };
    if (normalized.cabrio === true || normalized.cabrio === 'true') normalized.cabrio = 'Yes';
    else if (normalized.cabrio === false || normalized.cabrio === 'false') normalized.cabrio = 'No';
    if (typeof normalized.requiredExcess === 'number') normalized.requiredExcess = String(normalized.requiredExcess);
    return normalized as T;
}

const VALID_DRIVER_RESTRICTIONS = new Set([
    'POLICYHOLDER_ONLY',
    'NAMED_DRIVERS',
    'ANY_DRIVER_25_PLUS',
    'ANY_DRIVER_40_PLUS',
]);

/**
 * Legacy back-compat derivation for `driverRestriction` (ABY-232 /
 * ADR-0025). For quotes saved before the field existed, derive a
 * sensible coverage restriction from the legacy `hasAdditionalDrivers`
 * boolean so the downstream pricing / documents / claims code can
 * read one canonical value:
 *
 *   `hasAdditionalDrivers === false` → `POLICYHOLDER_ONLY`
 *   `hasAdditionalDrivers === true`  → `NAMED_DRIVERS`
 *
 * If the field is already set to a valid enum value it is left
 * untouched. If it is set to an unknown string, it is treated as
 * missing (the bind-stage validator will reject explicitly via
 * `validateMotorBindStage`, not silently default).
 */
export function normalizeDriverRestrictionCompatibility<T extends Record<string, unknown>>(quoteData: T): T {
    const normalized: Record<string, unknown> = { ...quoteData };
    const current = normalized.driverRestriction;
    if (typeof current === 'string' && VALID_DRIVER_RESTRICTIONS.has(current)) {
        return normalized as T;
    }
    if (current !== undefined && current !== null && current !== '') {
        // Unknown value — leave as-is so the stage validator can flag
        // it. We deliberately do not coerce or default to keep the
        // failure surface explicit (no-defensive-fallbacks rule).
        return normalized as T;
    }
    if (normalized.hasAdditionalDrivers === true) {
        normalized.driverRestriction = 'NAMED_DRIVERS';
    } else if (normalized.hasAdditionalDrivers === false) {
        normalized.driverRestriction = 'POLICYHOLDER_ONLY';
    }
    return normalized as T;
}

/**
 * Heuristic: classify a record as an EV from `fuelType` (canonical) or
 * make/model hints (CarDog data sometimes lacks `fuelType` and we infer
 * from the vehicle name). Used by `normalizeElectricVehicleCompatibility`
 * below to lock `fuelType = 'Electric'` for downstream consumers.
 *
 * Per ADR-0019 + canonical-ownership.md the **only** legitimate caller
 * of any normalization fan-out lives in
 * `packages/products/src/motor/vehicleEnrichment.ts`; this hint stays
 * here only because BO / BDX paths skip CarDog enrichment and need a
 * server-side classifier. Tracked as a follow-up consolidation.
 */
function inferElectricVehicle(input: Record<string, unknown>): boolean {
    const normalizedFuel = vehicleEnrichmentNormalization.normalizeFuelType(input.fuelType);
    if (normalizedFuel === 'Electric') return true;
    const haystack = `${String(input.make || '')} ${String(input.model || '')} ${String(input.vehicleType || '')}`.toLowerCase();
    return /\bev\b/.test(haystack)
        || haystack.includes('electric')
        || haystack.includes('e-tron')
        || haystack.includes('etron')
        || haystack.includes('(0)')
        || haystack.includes(' xpower e')
        || haystack.includes(' elite e');
}

/**
 * Normalize EV-related fields on a quote record.
 *
 * ADR-0102 defines `electricPowerKw` as the canonical EV power input. The
 * normalizer identifies fuel type only; it never creates a power value or an
 * engine-size sentinel.
 *
 * After PR 4 this helper:
 *   1. Normalizes `fuelType` via the canonical enrichment normalizer.
 *   2. If the record is classified as Electric (via fuelType or
 *      make/model hints) but has no canonical `fuelType === 'Electric'`,
 *      sets it. The wizard / BDX mapper / BO path must source the real
 *      manufacturer power. Missing `electricPowerKw` is rejected by Step 3
 *      and referred by `motorUwAutomation.ts`.
 */
export function normalizeElectricVehicleCompatibility<T extends Record<string, unknown>>(quoteData: T): T {
    const normalized: Record<string, unknown> = { ...quoteData };
    const normalizedFuel = vehicleEnrichmentNormalization.normalizeFuelType(normalized.fuelType);
    if (normalizedFuel) normalized.fuelType = normalizedFuel;
    const isElectric = inferElectricVehicle(normalized);
    if (!isElectric) return normalized as T;
    normalized.fuelType = 'Electric';
    return normalized as T;
}

// ── Sanitization ──────────────────────────────────────────────────

export function sanitizeAdditionalDrivers(value: unknown): AdditionalDriver[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => asRecord(entry))
        .map((entry) => ({
            firstName: String(entry.firstName ?? '').trim(),
            lastName: String(entry.lastName ?? '').trim(),
            dateOfBirth: String(entry.dateOfBirth ?? '').trim(),
            licenseYears: String(entry.licenseYears ?? '').trim(),
            email: String(entry.email ?? '').trim(),
            telephone: String(entry.telephone ?? '').trim(),
        }))
        .filter((entry) => Object.values(entry).some((v) => String(v || '').trim().length > 0));
}

// ── Start-date window ─────────────────────────────────────────────

export function startDateWindowBounds(): { min: Date; max: Date } {
    const min = new Date();
    min.setHours(0, 0, 0, 0);
    const max = new Date(min);
    max.setDate(max.getDate() + POLICY_START_MAX_DAYS_AHEAD);
    return { min, max };
}

export function assertStartDateWithinWindow(value: unknown, fieldName: string): void {
    const raw = String(value || '').trim();
    if (!raw) return;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
        throw new PublicApiError({
            httpStatus: 400,
            code: 'BAD_REQUEST',
            message: `${fieldName} is invalid`,
        });
    }
    date.setHours(0, 0, 0, 0);
    const { min, max } = startDateWindowBounds();
    if (date < min || date > max) {
        throw new PublicApiError({
            httpStatus: 400,
            code: 'BAD_REQUEST',
            message: `${fieldName} must be between today and ${POLICY_START_MAX_DAYS_AHEAD} days ahead`,
        });
    }
}
