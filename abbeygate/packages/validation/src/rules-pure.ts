/**
 * Atomic validation rules — pure (env-agnostic).
 *
 * Every rule here is a pure Zod schema or a small factory that returns one.
 * Pure rules have no dependency on React, RHF, libphonenumber-js, or any
 * environment-specific package.
 *
 * The single environment-specific rule (PhoneE164) lives in `rules-phone.ts`
 * and is built from this file's pure helpers plus an injected phone
 * validator. See `createValidationContext.ts` for how everything is wired
 * together.
 *
 * Why "atoms": we want every product's validation profile to be a list
 * of rule refs (`Email`, `Name`, `PhoneE164`) rather than a bespoke
 * superRefine block. Atoms can be composed; bespoke blocks cannot.
 *
 * Each atom exports a single source of truth for its error messages so
 * that wizard, BO Underwriting tab, and backend surfaces stay aligned.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// String atoms
// ---------------------------------------------------------------------------

/** Person name field. Trimmed, 2..50 chars. */
export const Name = z
  .string()
  .trim()
  .min(2, 'Please enter at least 2 characters')
  .max(50, 'Must be less than 50 characters');

/** Generic non-empty string with a configurable floor/ceiling. */
export function NonEmptyString(opts?: { min?: number; max?: number; label?: string }) {
  const min = opts?.min ?? 1;
  const max = opts?.max ?? 500;
  const label = opts?.label || 'value';
  let schema = z.string().trim().min(min, `Please enter a ${label}`);
  if (max) schema = schema.max(max, `Must be less than ${max} characters`);
  return schema;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

// Pragmatic email regex — same shape Motor has used successfully in production.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const Email = z
  .string()
  .trim()
  .min(1, 'Please enter your email address')
  .refine((value) => EMAIL_REGEX.test(value), 'Please enter a valid email address');

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Loose ISO date (YYYY-MM-DD). Accepts browser `<input type="date">` values. */
export const IsoDate = z
  .string()
  .trim()
  .refine((value) => {
    if (!value) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
  }, 'Please enter a valid date');

/** Parse either ISO (YYYY-MM-DD) or user-facing (DD/MM/YYYY) date strings. */
function parseDobFlexible(value: string): Date | null {
  const trimmed = value.trim();
  // DD/MM/YYYY — e.g. "25/04/1990"
  const ddmmyyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const d = new Date(`${yyyy}-${mm}-${dd}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // ISO / anything else JS understands
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Date of birth within a configurable age range.
 * Accepts ISO (YYYY-MM-DD) and DD/MM/YYYY formats.
 * Rejects future dates and nonsensical ancient dates.
 */
export function DOB(opts?: { minAge?: number; maxAge?: number }) {
  const minAge = opts?.minAge ?? 18;
  const maxAge = opts?.maxAge ?? 100;
  return z
    .string()
    .min(1, 'Please enter your date of birth')
    .superRefine((value, ctx) => {
      const dob = parseDobFlexible(value);
      if (!dob) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a valid date of birth' });
        return;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (dob > today) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date of birth cannot be in the future' });
        return;
      }
      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
      if (age < minAge) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `You must be at least ${minAge} to buy this insurance` });
      } else if (age > maxAge) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a valid date of birth' });
      }
    });
}

// ---------------------------------------------------------------------------
// Money / numbers
// ---------------------------------------------------------------------------

/**
 * Positive money amount (integer or float).
 * Accepts numbers or numeric strings (the wizard often stores both).
 */
export const PositiveMoney = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const num = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(num) || num <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter an amount greater than zero' });
      return z.NEVER;
    }
    return num;
  });

/** Non-negative money amount. Used when a product-level refinement validates a field pair. */
export const NonNegativeMoney = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const num = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(num) || num < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter an amount of zero or greater' });
      return z.NEVER;
    }
    return num;
  });

/** Percentage 0..100. */
export const Percentage = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    const num = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a percentage between 0 and 100' });
      return z.NEVER;
    }
    return num;
  });

/** Integer or float within a range. */
export function NumberRange(opts: { min: number; max: number; label?: string }) {
  const label = opts.label || 'number';
  return z
    .union([z.number(), z.string()])
    .transform((value, ctx) => {
      const num = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(num) || num < opts.min || num > opts.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Please enter a ${label} between ${opts.min} and ${opts.max}`,
        });
        return z.NEVER;
      }
      return num;
    });
}

// ---------------------------------------------------------------------------
// Country / postcode
// ---------------------------------------------------------------------------

function normalizeCountryName(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COUNTRY_NAME_ALIASES: Record<string, string> = {
  [normalizeCountryName('uk')]: normalizeCountryName('United Kingdom'),
  [normalizeCountryName('u.k.')]: normalizeCountryName('United Kingdom'),
  [normalizeCountryName('united states')]: normalizeCountryName('United States of America'),
  [normalizeCountryName('usa')]: normalizeCountryName('United States of America'),
  [normalizeCountryName('u.s.a.')]: normalizeCountryName('United States of America'),
  [normalizeCountryName('us')]: normalizeCountryName('United States of America'),
  [normalizeCountryName('uae')]: normalizeCountryName('United Arab Emirates'),
  [normalizeCountryName('czechia (czech republic)')]: normalizeCountryName('Czech Republic'),
  [normalizeCountryName('congo (congo-brazzaville)')]: normalizeCountryName('Congo - Brazzaville'),
  [normalizeCountryName('democratic republic of the congo')]: normalizeCountryName('Congo - Kinshasa'),
  [normalizeCountryName('eswatini (fmr. swaziland)')]: normalizeCountryName('Eswatini'),
  [normalizeCountryName('myanmar (formerly burma)')]: normalizeCountryName('Myanmar'),
  [normalizeCountryName('palestine state')]: normalizeCountryName('Palestine'),
};

function isKnownCountryName(value: string): boolean {
  const normalized = normalizeCountryName(value);
  if (!normalized) return false;
  const canonical = COUNTRY_NAME_ALIASES[normalized] || normalized;
  try {
    const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    const regionCodes = typeof supportedValuesOf === 'function'
      ? supportedValuesOf('region')
      : (() => {
          const codes: string[] = [];
          for (let i = 65; i <= 90; i += 1) {
            for (let j = 65; j <= 90; j += 1) {
              const code = String.fromCharCode(i, j);
              const name = displayNames.of(code);
              if (name && name !== code) codes.push(code);
            }
          }
          return codes;
        })();
    if (!regionCodes || regionCodes.length === 0) return true;
    return regionCodes.some((code) => normalizeCountryName(displayNames.of(code) || '') === canonical);
  } catch {
    // When runtime country metadata is unavailable, avoid false negatives on
    // valid user-provided country names and rely on product option contracts.
    return true;
  }
}

export const CountryName = z
  .string()
  .trim()
  .min(2, 'Please enter a country')
  .refine(isKnownCountryName, 'Please select a valid country');

/**
 * Country-aware postcode rule.
 *
 * Recognised countries below; everything else falls back to "at least 3
 * characters". This is the single source of truth for postcode format and
 * absorbs the historical regex from the now-deleted
 * `frontend/src/modules/policies/validation/addressValidation.ts`
 * (Phase 8 moved the kept-FE-only mirror into `@facio/products`).
 */
export function PostcodeForCountry(country: string | undefined) {
  const c = String(country || '').trim().toLowerCase();
  return z
    .string()
    .trim()
    .min(1, 'Please enter your post code')
    .superRefine((value, ctx) => {
      if ((c === 'united states of america' || c === 'united states') && !/^\d{5}(?:-\d{4})?$/.test(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'US ZIP code must be 5 digits (or ZIP+4)' });
        return;
      }
      if (c === 'portugal' && !/^\d{4}-?\d{3}$/.test(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Portugal post code must be in 1234-567 format' });
        return;
      }
      if (c === 'united kingdom' && !/^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(value.replace(/\s+/g, ' '))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid UK post code' });
        return;
      }
      if (value.length < 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Post Code must be at least 3 characters' });
      }
    });
}

// ---------------------------------------------------------------------------
// Identity documents
// ---------------------------------------------------------------------------

/** Tax/national ID (NIF). Currently just non-empty + length bounds; product
 *  profiles may replace with a stricter country-specific variant. */
export const Nif = z
  .string()
  .trim()
  .min(3, 'Please enter a valid identification number')
  .max(30, 'Identification number is too long');

// ---------------------------------------------------------------------------
// Enumerations and booleans
// ---------------------------------------------------------------------------

/** Literal enum over a closed set of string values. */
export function EnumOf<T extends readonly [string, ...string[]]>(values: T, label?: string) {
  const allowed = new Set<string>(values);
  const message = `Please select a valid ${label || 'option'}`;
  return z
    .string()
    .refine((value) => allowed.has(value), message) as unknown as z.ZodType<T[number]>;
}

/**
 * Narrow boolean coercion (Amendment #4.1 — see canonical-contract.test.ts).
 *
 * RHF and native form serialisation routinely round-trip checkbox/radio
 * values as the literal lowercase strings `'true'` / `'false'`. The
 * `mustAccept` and `bool` atoms therefore accept those exact two strings
 * as surrogates for the corresponding boolean.
 *
 * IMPORTANT: this carve-out is intentionally tiny. We do NOT accept
 * `'TRUE'`, `'1'`, `'yes'`, `'on'`, etc. — anything that isn't one of
 * the two literal strings is forwarded unchanged, so the wrapped
 * `z.boolean()` still owns the type-check verdict and genuine upstream
 * data-shape bugs continue to surface as validation errors.
 */
export const coerceBool = (v: unknown): unknown => {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
};

/** Required boolean that must be true (used by "I accept..." checkboxes). */
export const MustAccept = z.preprocess(
  coerceBool,
  z.boolean('You must accept to continue').refine((value) => value === true, 'You must accept to continue'),
);

/** Plain boolean (optional truth value). */
export const BoolFlag = z.preprocess(coerceBool, z.boolean('Please choose Yes or No'));

// ---------------------------------------------------------------------------
// Conditional rules (combinators)
// ---------------------------------------------------------------------------

/**
 * Cross-field conditional refinement: field `key` is required when
 * `predicate(data)` is true. Attach the returned function to a composed
 * object schema via `.superRefine`.
 *
 * SCOPE RULE (Amendment #2):
 *   Use this combinator ONLY for trivial LOCAL field dependency —
 *   one-to-one ("claimsDetails required when hasClaims is true").
 *   If your predicate reads more than one sibling, encodes underwriting
 *   policy, or wants a non-obvious branch, write a NAMED profile-level
 *   refinement in `products/<code>/validation/profile.ts` instead. The
 *   goal is that business logic always has a readable name, a file you
 *   can grep for, and its own test.
 *
 * Example (good):
 *   requiredIf('claimsDetails', (d) => d.hasClaims === true,
 *     'Claims details are required')
 *
 * Example (bad — encodes policy; belongs in a named refinement):
 *   requiredIf('driverNarrative',
 *     (d) => Number(d.claimsCount) > 2 && d.licenseYears < 5,
 *     'Narrative required for high-risk drivers')
 */
export function requiredIf<T extends Record<string, unknown>>(
  key: string,
  predicate: (data: T) => boolean,
  message: string,
) {
  return (data: T, ctx: z.RefinementCtx) => {
    if (!predicate(data)) return;
    const value = (data as Record<string, unknown>)[key];
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (Array.isArray(value) && value.length === 0);
    if (isEmpty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// OneOf — validates that the value is one of a fixed allowed set.
// Used for select fields where the manifest owns the canonical option list but
// the validation profile wants to enforce the constraint server-side too.
// Ref format: `oneOf:Value One|Value Two|Value Three`  (pipe-separated).
// ---------------------------------------------------------------------------

/**
 * Validates that the trimmed string value appears in `allowedValues`.
 * Comparison is case-sensitive to match the stored enum values exactly.
 */
export function OneOf(allowedValues: string[]): z.ZodTypeAny {
  const allowed = allowedValues.map((v) => v.trim()).filter(Boolean);
  const joined = allowed.map((v) => `"${v}"`).join(', ');
  return z
    .string()
    .trim()
    .min(1, 'Please select an option')
    .refine((v) => allowed.includes(v.trim()), `Please select one of: ${joined}`);
}

// ---------------------------------------------------------------------------
// Arrays
// ---------------------------------------------------------------------------

/** Non-empty array of non-empty strings. Used for multiselect fields (e.g. trip destinations). */
export const NonEmptyStringArray = z
  .array(z.string().min(1))
  .min(1, 'Please select at least one option');
