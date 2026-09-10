/**
 * Product-scoped policy/quote number schemes (ADR-0047, extended by ADR-0061).
 *
 * Single source of truth for the *carrier-branded* identifier formats that
 * diverge from the ADR-0034 default (`ABOLV/<CC><SEQ>` / `ABQ/<CC><SEQ>`).
 * This module is intentionally data-only: it declares, per product code,
 * how the identifier is built, where the sequence starts, which per-tenant
 * sequence-key namespace it uses, and how to recognise/floor existing rows.
 *
 * Consumed exclusively by `platformIds.ts` — the canonical owner of every
 * customer-facing identifier. Products absent from the registry fall back to
 * the ADR-0034 default handled directly in `platformIds.ts`, so Home (and any
 * future product) are unaffected until they opt in here.
 *
 * NOTE (ADR-0047): the branded sequence is always rendered as a 7-digit,
 * zero-padded number, so lexicographic ordering on `policyNumber` matches
 * numeric ordering for the floor scan (same guarantee ADR-0034 relies on).
 *
 * ADR-0061 adds two things for Motor/Santam:
 *   1. An `origin` axis (`ONLINE` | `MANUAL`) that selects a policy stream —
 *      online sales and manually-entered policies share the `AB/ST/…` format
 *      but run on independent counters with different start sequences.
 *   2. A CY-omits-country-code format (CY is the home market; PT/ES are marked).
 */

export type PolicyNumberKind = 'POLICY' | 'QUOTE';

/** How a policy was created — selects the Motor/Santam policy stream (ADR-0061). */
export type IssueOrigin = 'ONLINE' | 'MANUAL';

/**
 * Floor-scan descriptor: find the latest existing row whose `policyNumber`
 * starts with `startsWith`, extract the trailing sequence with `seqRegex`, and
 * floor the counter above it. `gte`/`lt` (ADR-0061) restrict the scan to one
 * numeric band so two streams sharing a prefix (`AB/ST/` online vs manual) do
 * not drag each other's counters — valid because the sequence is fixed-width.
 */
export interface BrandedNumberScan {
  startsWith: string;
  seqRegex: RegExp;
  gte?: string;
  lt?: string;
}

export interface BrandedNumberScheme {
  /** Per-tenant `policyNumberSequence` key namespace (e.g. `DIRECT/BRIT/ABG`). */
  keySuffix: string;
  /** First sequence value issued for this product/kind and territory. */
  startSeq: number | ((countryCode: string) => number);
  /** Build the final identifier from the tenant country code + padded sequence. */
  format: (countryCode: string, paddedSeq: string) => string;
  /** Floor-scan descriptors (see {@link BrandedNumberScan}). */
  scans: (countryCode: string) => BrandedNumberScan[];
  /** Country-agnostic anchored matcher used by the canonical predicates. */
  matchRegex: RegExp;
}

const TRAVEL_POLICY: BrandedNumberScheme = {
  keySuffix: 'DIRECT/BRIT/ABG',
  startSeq: 5_000_010,
  format: (cc, seq) => `DIRECT/BRIT/ABG/${cc}/${seq}`,
  scans: (cc) => [{ startsWith: `DIRECT/BRIT/ABG/${cc}/`, seqRegex: new RegExp(`^DIRECT/BRIT/ABG/${cc}/(\\d+)$`) }],
  matchRegex: /^DIRECT\/BRIT\/ABG\/[A-Z]{2}\/\d+$/,
};

const TRAVEL_QUOTE: BrandedNumberScheme = {
  keySuffix: 'DIRECT/BRIT/ABG/Q',
  startSeq: 5_000_010,
  format: (cc, seq) => `DIRECT/BRIT/ABG/${cc}/Q/${seq}`,
  scans: (cc) => [{ startsWith: `DIRECT/BRIT/ABG/${cc}/Q/`, seqRegex: new RegExp(`^DIRECT/BRIT/ABG/${cc}/Q/(\\d+)$`) }],
  matchRegex: /^DIRECT\/BRIT\/ABG\/[A-Z]{2}\/Q\/\d+$/,
};

const HEALTH_POLICY: BrandedNumberScheme = {
  keySuffix: 'BRIT/ABG/IM',
  startSeq: 5_001_025,
  format: (cc, seq) => `BRIT/ABG/${cc}/IM/${seq}`,
  scans: (cc) => [{ startsWith: `BRIT/ABG/${cc}/IM/`, seqRegex: new RegExp(`^BRIT/ABG/${cc}/IM/(\\d+)$`) }],
  matchRegex: /^BRIT\/ABG\/[A-Z]{2}\/IM\/\d+$/,
};

const HEALTH_QUOTE: BrandedNumberScheme = {
  keySuffix: 'BRIT/ABG/IM/Q',
  startSeq: 5_001_025,
  format: (cc, seq) => `BRIT/ABG/${cc}/IM/Q/${seq}`,
  scans: (cc) => [{ startsWith: `BRIT/ABG/${cc}/IM/Q/`, seqRegex: new RegExp(`^BRIT/ABG/${cc}/IM/Q/(\\d+)$`) }],
  matchRegex: /^BRIT\/ABG\/[A-Z]{2}\/IM\/Q\/\d+$/,
};

// ── Home (ADR-0047 extension) ────────────────────────────────────────────────
// Home issues under the carrier-branded `BZ` prefix (Danny/Peter, 2026-08-14):
// `BZ/<CC><seq>` e.g. `BZ/CY5000001`, mirroring the ADR-0034 default layout
// (country code concatenated directly onto the 7-digit sequence) but with the
// carrier prefix instead of the generic `ABOLV`. Applies to NEW Home issuances;
// already-issued `ABOLV/…` Home rows keep their number (Lloyd's bordereaux
// identity, ADR-0056) unless a separate audited renumber migration runs.
//
// Only the POLICY number is branded. Home quotes stay on the ADR-0034 default
// (`ABQ/<CC><seq>`) — the default already uses a different prefix for quotes vs
// policies, so there is no branded Home QUOTE scheme (QUOTE is optional below).
const HOME_POLICY: BrandedNumberScheme = {
  keySuffix: 'BZ',
  startSeq: 5_000_001,
  format: (cc, seq) => `BZ/${cc}${seq}`,
  scans: (cc) => [{ startsWith: `BZ/${cc}`, seqRegex: new RegExp(`^BZ/${cc}(\\d+)$`) }],
  matchRegex: /^BZ\/[A-Z]{2}\d+$/,
};

// ── Motor / Santam (ADR-0061) ────────────────────────────────────────────────
// CY is the home market and carries no country token; PT/ES are marked. Online
// and manual policies share the `AB/ST/…` format but run on independent counters
// (5,000,100 vs 1,000,100 start). Facio quotes are online-only, use the
// 5,000,100 range, and are prefixed `Q/`.
const SANTAM_MOTOR_ONLINE_START = 5_000_100;
const SANTAM_MOTOR_MANUAL_START = 1_000_100;

function santamMotorQuoteStart(cc: string): number {
  return cc === 'ES' ? SANTAM_MOTOR_MANUAL_START : SANTAM_MOTOR_ONLINE_START;
}

/** `AB/ST/<seq>` for CY, `AB/ST/<CC>/<seq>` for PT/ES. */
function santamPolicyFormat(cc: string, seq: string): string {
  return cc === 'CY' ? `AB/ST/${seq}` : `AB/ST/${cc}/${seq}`;
}

/** `Q/<seq>` for CY, `Q/<CC>/<seq>` for PT/ES. */
function santamQuoteFormat(cc: string, seq: string): string {
  return cc === 'CY' ? `Q/${seq}` : `Q/${cc}/${seq}`;
}

function santamPolicyPrefix(cc: string): string {
  return cc === 'CY' ? 'AB/ST/' : `AB/ST/${cc}/`;
}

function santamPolicySeqRegex(cc: string): RegExp {
  return cc === 'CY' ? /^AB\/ST\/(\d+)$/ : new RegExp(`^AB/ST/${cc}/(\\d+)$`);
}

const MOTOR_POLICY_ONLINE: BrandedNumberScheme = {
  keySuffix: 'AB/ST/ONLINE',
  startSeq: SANTAM_MOTOR_ONLINE_START,
  format: santamPolicyFormat,
  // Online floor stays at/above the online start so it never counts a manual row.
  scans: (cc) => [{
    startsWith: santamPolicyPrefix(cc),
    seqRegex: santamPolicySeqRegex(cc),
    gte: santamPolicyFormat(cc, String(SANTAM_MOTOR_ONLINE_START)),
  }],
  matchRegex: /^AB\/ST\/([A-Z]{2}\/)?\d+$/,
};

const MOTOR_POLICY_MANUAL: BrandedNumberScheme = {
  keySuffix: 'AB/ST/MANUAL',
  startSeq: SANTAM_MOTOR_MANUAL_START,
  format: santamPolicyFormat,
  // Manual floor is capped below the online start so an online row never drags
  // the manual counter up into the 5,000,000 range.
  scans: (cc) => [{
    startsWith: santamPolicyPrefix(cc),
    seqRegex: santamPolicySeqRegex(cc),
    lt: santamPolicyFormat(cc, String(SANTAM_MOTOR_ONLINE_START)),
  }],
  matchRegex: /^AB\/ST\/([A-Z]{2}\/)?\d+$/,
};

const MOTOR_QUOTE: BrandedNumberScheme = {
  keySuffix: 'Q',
  // ADR-0092 changes Facio territories only. Spain retains the ADR-0061
  // Motor quote start range until an explicit Spain numbering decision.
  startSeq: santamMotorQuoteStart,
  format: santamQuoteFormat,
  scans: (cc) => [{
    startsWith: cc === 'CY' ? 'Q/' : `Q/${cc}/`,
    seqRegex: cc === 'CY' ? /^Q\/(\d+)$/ : new RegExp(`^Q/${cc}/(\\d+)$`),
  }],
  matchRegex: /^Q\/([A-Z]{2}\/)?\d+$/,
};

/**
 * Policy schemes may be split by {@link IssueOrigin}; quote schemes are not.
 * A `POLICY` entry is either a single scheme (Travel/Health) or an origin map
 * (Motor/Santam). `resolvePolicyScheme` collapses the origin.
 */
type PolicyEntry = BrandedNumberScheme | Readonly<Record<IssueOrigin, BrandedNumberScheme>>;

interface ProductSchemes {
  POLICY: PolicyEntry;
  /**
   * Branded QUOTE scheme. Optional: a product may brand only its policy number
   * and leave quotes on the ADR-0034 default (`ABQ/<CC><seq>`) — the default
   * already prefixes quotes and policies differently, so this is not a
   * regression. Home does exactly this.
   */
  QUOTE?: BrandedNumberScheme;
}

const REGISTRY: Readonly<Record<string, ProductSchemes>> = {
  TRAVEL: { POLICY: TRAVEL_POLICY, QUOTE: TRAVEL_QUOTE },
  HEALTH: { POLICY: HEALTH_POLICY, QUOTE: HEALTH_QUOTE },
  HOME: { POLICY: HOME_POLICY },
  MOTOR: {
    POLICY: { ONLINE: MOTOR_POLICY_ONLINE, MANUAL: MOTOR_POLICY_MANUAL },
    QUOTE: MOTOR_QUOTE,
  },
};

function isOriginMap(
  entry: PolicyEntry,
): entry is Readonly<Record<IssueOrigin, BrandedNumberScheme>> {
  return typeof (entry as BrandedNumberScheme).format !== 'function';
}

function resolvePolicyScheme(entry: PolicyEntry, origin: IssueOrigin): BrandedNumberScheme {
  return isOriginMap(entry) ? entry[origin] : entry;
}

/**
 * Return the branded scheme for a product/kind, or `null` when the product
 * uses the ADR-0034 default. `productType` is normalised to upper-case.
 *
 * `origin` selects the policy stream for products that split by origin
 * (Motor/Santam). It is ignored for quotes and for products that do not split
 * (their online/manual policies share one scheme), so the default is safe for
 * formatting and matching — only reservation needs the real origin.
 */
export function getBrandedNumberScheme(
  productType: string | null | undefined,
  kind: PolicyNumberKind,
  origin: IssueOrigin = 'ONLINE',
): BrandedNumberScheme | null {
  const key = String(productType || '').trim().toUpperCase();
  const entry = REGISTRY[key];
  if (!entry) return null;
  return kind === 'POLICY' ? resolvePolicyScheme(entry.POLICY, origin) : (entry.QUOTE ?? null);
}

/** True when `value` matches any branded scheme of the given kind (any country). */
export function matchesBrandedNumber(value: string | null | undefined, kind: PolicyNumberKind): boolean {
  const v = String(value || '').trim();
  if (!v) return false;
  for (const entry of Object.values(REGISTRY)) {
    if (kind === 'QUOTE') {
      if (entry.QUOTE && entry.QUOTE.matchRegex.test(v)) return true;
      continue;
    }
    const policy = entry.POLICY;
    const schemes = isOriginMap(policy) ? Object.values(policy) : [policy];
    if (schemes.some((s) => s.matchRegex.test(v))) return true;
  }
  return false;
}
