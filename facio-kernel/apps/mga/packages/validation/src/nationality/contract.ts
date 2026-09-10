/**
 * Canonical Nationality contract — the single source of truth for the
 * "what is the proposer's nationality?" field across every product,
 * surface, default, fixture, payload mapper, and BDX import.
 *
 * ADR-0010 says: if code and docs disagree, docs win. This file IS the
 * canonical doc for nationality. The CI guard
 * `tools/quality/check-contracts-product-consistency.mjs` cross-checks
 * every product profile, manifest, region config, jurisdiction default,
 * prisma seed, fixture, and payload mapper against the rules below and
 * fails CI on drift.
 *
 * To relax or extend any rule:
 *   1. Amend ADR-0010 (or open a new ADR that supersedes this contract).
 *   2. Update this file.
 *   3. Regenerate `docs/reference/contracts.md`
 *      (`npm run docs:generate -- --only=contracts`).
 *   4. Migrate every callsite the guard flags.
 *   5. Land it in one PR.
 *
 * Forbidden everywhere:
 *   - Product-local fallback lists for nationality.
 *   - Storing demonyms (`'British'`, `'Cypriot'`, `'Portuguese'`).
 *   - Storing ISO codes (`'GB'`, `'CY'`).
 *   - Writing flat `quoteData.nationality` (must be `quoteData.proposer.nationality`).
 *   - A product profile that requires nationality at a step but omits it from
 *     the bind/issuance stage gates.
 *
 * Why country names (not ISO codes): every wizard renders a search-by-name
 * dropdown sourced from the same canonical list. Storing the displayed
 * value matches the rest of the platform (address.country, eligibility.
 * countryOfResidence, vehicleLocation, etc.) and avoids a second
 * decode/encode boundary for read paths. A future ADR may switch to
 * ISO-3166-2 codes; until then, the country name IS the canonical atom.
 */

import { z } from 'zod';

/**
 * Canonical, alphabetically ordered list of allowed nationality values.
 *
 * This list is a strict subset/identity-of the shared country list at
 * `packages/products/src/shared/countries.ts`. The two MUST stay in
 * sync; the consistency guard checks set equality.
 */
export const NATIONALITY_OPTIONS = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
  'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi',
  'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo (Congo-Brazzaville)', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czechia (Czech Republic)',
  'Democratic Republic of the Congo', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic',
  'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini (fmr. Swaziland)', 'Ethiopia',
  'Fiji', 'Finland', 'France',
  'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana',
  'Haiti', 'Holy See', 'Honduras', 'Hungary',
  'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy',
  'Jamaica', 'Japan', 'Jordan',
  'Kazakhstan', 'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan',
  'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar (formerly Burma)',
  'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway',
  'Oman',
  'Pakistan', 'Palau', 'Palestine State', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar',
  'Romania', 'Russia', 'Rwanda',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria',
  'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States of America', 'Uruguay', 'Uzbekistan',
  'Vanuatu', 'Venezuela', 'Vietnam',
  'Yemen',
  'Zambia', 'Zimbabwe',
] as const;

export type Nationality = (typeof NATIONALITY_OPTIONS)[number];

const NATIONALITY_SET: ReadonlySet<string> = new Set(NATIONALITY_OPTIONS);

/** Type guard — true iff `value` is a canonical nationality string. */
export function isCanonicalNationality(value: unknown): value is Nationality {
  return typeof value === 'string' && NATIONALITY_SET.has(value);
}

/**
 * Canonical Zod rule. Wired into the validation registry as `nationality`.
 * Profiles MUST reference the rule by name (`rule: 'nationality'`) rather
 * than embedding `z.string()` or `nonEmptyString` for the nationality
 * field — the consistency guard fails CI on the latter.
 */
export const nationalityRule = z
  .string()
  .trim()
  .min(2, 'Please select a nationality')
  .refine((v) => NATIONALITY_SET.has(v), 'Please select a valid nationality');

/**
 * Canonical payload path inside `quoteData`. Writing flat
 * `quoteData.nationality` is forbidden — every surface (wizard, BO,
 * client portal, BDX import) MUST write `quoteData.proposer.nationality`.
 */
export const NATIONALITY_PAYLOAD_PATH = 'proposer.nationality' as const;

/**
 * Per-product lifecycle requirements.
 *
 * `collected: true`  → manifest exposes the field, profile validates it,
 *                       and the listed stages MUST gate on it.
 * `collected: false` → manifest MUST NOT expose the field; profile MUST
 *                       NOT list it; stage list is empty. (Travel.)
 *
 * The consistency guard verifies all three conditions together.
 */
export const NATIONALITY_PRODUCT_REQUIREMENTS = {
  HOME: { collected: true, stages: ['bind', 'issuance'] as const },
  MOTOR: { collected: true, stages: ['bind'] as const },
  TRAVEL: { collected: false, stages: [] as const },
} as const satisfies Record<
  string,
  { collected: boolean; stages: readonly ('quote' | 'bind' | 'issuance')[] }
>;

export type NationalityProductCode = keyof typeof NATIONALITY_PRODUCT_REQUIREMENTS;

/**
 * Legacy demonym → canonical country name. Used ONLY by data migrations
 * (e.g. the Tenant.defaultNationality column SQL update). Runtime code
 * MUST NOT consult this map — that would re-introduce silent acceptance
 * of demonyms and defeat the contract.
 */
export const NATIONALITY_DEMONYM_TO_COUNTRY = {
  British: 'United Kingdom',
  Cypriot: 'Cyprus',
  Greek: 'Greece',
  Portuguese: 'Portugal',
  Spanish: 'Spain',
} as const satisfies Record<string, Nationality>;

/**
 * Aggregate metadata read by `tools/docs/generate-contracts.mjs` to
 * produce the row in `docs/reference/contracts.md`.
 */
export const NATIONALITY_CONTRACT = {
  field: 'nationality',
  family: 'shared-proposer',
  payloadPath: NATIONALITY_PAYLOAD_PATH,
  options: NATIONALITY_OPTIONS,
  productRequirements: NATIONALITY_PRODUCT_REQUIREMENTS,
  owner: 'platform-validation',
} as const;
