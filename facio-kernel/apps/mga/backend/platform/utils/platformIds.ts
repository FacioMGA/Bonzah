import type { Prisma, PrismaClient } from '@prisma/client';
import { runTenantScopedTransaction } from '../db/connection.js';
import { getTenantConfig } from '../tenant/tenantConfig.js';
import {
  type BrandedNumberScheme,
  type IssueOrigin,
  getBrandedNumberScheme,
  matchesBrandedNumber,
} from './policyNumberScheme.js';

type Tx = Prisma.TransactionClient | PrismaClient;

const START_SEQ = 1_000_001;
// Per the Facio customer-reference rule (ADR-0092), new customer-facing
// default quote/policy numbers for Abbeygate's operating territories begin in
// the 5,000,000 range. Existing rows retain their original identifiers; the
// floor-then-reserve logic moves only future reservations into the new range.
const DEFAULT_START_SEQ_BY_COUNTRY: Readonly<Record<string, number>> = {
  CY: 5_000_001,
  PT: 5_000_001,
  GR: 5_000_001,
};

function defaultStartSeqForTenant(): number {
    return DEFAULT_START_SEQ_BY_COUNTRY[getTenantConfig().countryCode] ?? START_SEQ;
}
const CERTIFICATE_START_SEQ = 825_000_000;
const GREEN_CARD_SERIAL_START_SEQ = 824_000_000;
const CLAIM_START_SEQ = 1;

const DEFAULT_QUOTE_PREFIX = 'ABQ';
const DEFAULT_POLICY_PREFIX = 'ABOLV';

const sharedPlatformMode = () => process.env.KERNEL_PLATFORM_MODE === 'true';
const PLATFORM_REFERENCE = /^[A-Z0-9][A-Z0-9-]{0,11}-[A-Z]{2}-[A-Z][A-Z0-9_]{0,31}-([PQ])\d+$/;

function formatPlatformReference(kind: 'P' | 'Q', sequence: number, productType?: string | null): string {
  const tenant = getTenantConfig();
  const prefix = tenant.tenantSlug.toUpperCase().slice(0, 12).replace(/-+$/, '');
  const product = String(productType || 'GENERAL').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(prefix) || !/^[A-Z]{2}$/.test(tenant.countryCode) || !/^[A-Z][A-Z0-9_]{0,31}$/.test(product)) throw new Error('Invalid tenant or product numbering identity.');
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invalid reserved identifier sequence.');
  return `${prefix}-${tenant.countryCode}-${product}-${kind}${String(sequence).padStart(7, '0')}`;
}

/** One database counter per reference kind; slug truncation cannot cause a collision.
 * Migration seeds these above all legacy reservations (and numeric policy fields).
 * Missing migrations and integer exhaustion fail closed; no timestamp fallback. */
async function reservePlatformSequence(tx: Tx, kind: 'POLICY' | 'QUOTE' | 'CERTIFICATE' | 'GREENCARD'): Promise<number> {
  getTenantConfig();
  const row = await tx.policyNumberSequence.update({ where: { key: `PLATFORM:GLOBAL:${kind}` }, data: { next: { increment: 1 } }, select: { next: true } });
  return row.next - 1;
}


/**
 * Tenant-scoped sequence keys keep each operating tenant on its own
 * counter row in `policy_number_sequence`. Combined with the tenant
 * code embedded in `formatQuoteId`/`formatPolicyId` (ADR-0034), this
 * makes collisions across tenants structurally impossible — every
 * operating tenant has its own namespace AND every emitted identifier
 * is globally unique by construction.
 */
function tenantSequenceKey(kind: 'QUOTE' | 'POLICY' | 'CERTIFICATE' | 'GREENCARD' | 'CLAIM', suffix?: string): string {
  const tenant = getTenantConfig();
  const base = `${tenant.tenantSlug.toUpperCase()}:${kind}`;
  return suffix ? `${base}:${suffix}` : base;
}

function reserveNext(tx: Tx, key: string, startSeq: number = START_SEQ) {
  return tx.policyNumberSequence.upsert({
    where: { key },
    create: { key, next: startSeq + 1 },
    update: { next: { increment: 1 } },
    select: { next: true },
  }).then((row) => row.next - 1);
}

/**
 * Floor the per-tenant sequence above every existing `policyNumber`
 * matching the tenant's prefix — across BOTH the canonical tenant-coded
 * format (`ABQ/CY1000042`, ADR-0034) AND the unprefixed pre-ADR-0034
 * format (`ABQ1000042`, applied to CY's historical data before the
 * tenant code was embedded in the identifier itself). The Prisma
 * extension auto-scopes `policy.findFirst` by `operatingTenantId`, so
 * each tenant only sees its own rows and the floors never bleed across
 * tenants. We run two narrow queries (prefixed + unprefixed) instead of
 * one sort-by-string query because lexicographic ordering on
 * `policyNumber` does not match numeric ordering once the `/` separator
 * is introduced.
 */
async function reserveNextPolicyNumber(tx: Tx, key: string, prefix: string, startSeq: number = START_SEQ) {
  const tenant = getTenantConfig();
  const cc = tenant.countryCode;
  const prefixedFormatPrefix = `${prefix}/${cc}`;
  const prefixedPattern = new RegExp(`^${prefix}/${cc}(\\d+)$`);
  const unprefixedPattern = new RegExp(`^${prefix}(\\d+)$`);

  const [latestPrefixed, latestUnprefixed] = await Promise.all([
    tx.policy.findFirst({
      where: { policyNumber: { startsWith: prefixedFormatPrefix } },
      orderBy: { policyNumber: 'desc' },
      select: { policyNumber: true },
    }),
    tx.policy.findFirst({
      where: {
        AND: [
          { policyNumber: { startsWith: prefix } },
          { NOT: { policyNumber: { contains: '-' } } },
          { NOT: { policyNumber: { contains: '/' } } },
        ],
      },
      orderBy: { policyNumber: 'desc' },
      select: { policyNumber: true },
    }),
  ]);

  const prefixedMatch = String(latestPrefixed?.policyNumber || '').match(prefixedPattern);
  const unprefixedMatch = String(latestUnprefixed?.policyNumber || '').match(unprefixedPattern);
  const prefixedSeq = prefixedMatch ? Number(prefixedMatch[1]) : NaN;
  const unprefixedSeq = unprefixedMatch ? Number(unprefixedMatch[1]) : NaN;

  const validSeqs = [prefixedSeq, unprefixedSeq].filter((n) => Number.isSafeInteger(n));
  const hasExistingFloor = validSeqs.length > 0;
  const floor = hasExistingFloor ? Math.max(startSeq, ...validSeqs) : startSeq;

  const seq = await reserveNext(tx, key, floor);
  if (!hasExistingFloor || seq > floor) return seq;
  await tx.policyNumberSequence.update({
    where: { key },
    data: { next: floor + 2 },
  });
  return floor + 1;
}

/**
 * Reserve the next sequence for a carrier-branded scheme (ADR-0047). Mirrors
 * `reserveNextPolicyNumber`'s floor-then-reserve guarantee, but the prefix and
 * sequence regex come from the scheme instead of the fixed `<PREFIX>/<CC>`
 * shape. Branded formats are fresh namespaces, so the floor is `scheme.startSeq`
 * until a branded row exists; legacy `ABOLV`/`ABQ` rows are a different
 * namespace and are intentionally not renamed.
 */
async function reserveNextBrandedNumber(tx: Tx, key: string, scheme: BrandedNumberScheme) {
  const cc = getTenantConfig().countryCode;
  const startSeq = typeof scheme.startSeq === 'function' ? scheme.startSeq(cc) : scheme.startSeq;
  const scans = scheme.scans(cc);
  const rows = await Promise.all(
    scans.map((scan) =>
      tx.policy.findFirst({
        where: {
          policyNumber: {
            startsWith: scan.startsWith,
            // Band bounds (ADR-0061) keep two streams sharing one prefix
            // (`AB/ST/` online vs manual) from flooring against each other.
            ...(scan.gte ? { gte: scan.gte } : {}),
            ...(scan.lt ? { lt: scan.lt } : {}),
          },
        },
        orderBy: { policyNumber: 'desc' },
        select: { policyNumber: true },
      }),
    ),
  );

  const seqs = rows
    .map((row, i) => {
      const match = String(row?.policyNumber || '').match(scans[i].seqRegex);
      return match ? Number(match[1]) : NaN;
    })
    .filter((n) => Number.isSafeInteger(n));

  const hasExistingFloor = seqs.length > 0;
  const floor = hasExistingFloor ? Math.max(startSeq, ...seqs) : startSeq;

  const seq = await reserveNext(tx, key, floor);
  if (!hasExistingFloor || seq > floor) return seq;
  await tx.policyNumberSequence.update({
    where: { key },
    data: { next: floor + 2 },
  });
  return floor + 1;
}

// Numeric-column floor for fields that store a stringified positive integer
// (certificateNumber, greenCardSerial). Mirrors reserveNextPolicyNumber's
// guarantee: the returned value is strictly greater than any value already
// present on the policy table, so we can never collide with a row that was
// inserted out-of-band — e.g. a BDX import that carries the originating
// certificate number from the source system. Without this floor, the local
// per-tenant counter can re-issue an integer that an imported row already
// holds, which trips the @unique constraint on Policy.certificateNumber and
// surfaces as the "We hit a snag — Unique constraint failed on the fields:
// (`certificateNumber`)" error on the customer payment page (ABY-122 / ABY-120).
//
// `Policy.certificateNumber` and `Policy.greenCardSerial` are GLOBALLY unique
// (`@unique`, NOT `@@unique([operatingTenantId, …])`). The floor MUST therefore
// be read across ALL tenants. Two earlier bugs both stemmed from reading a
// tenant-LOCAL max here:
//   1. The tenant Prisma extension auto-injects `where: { operatingTenantId }`
//      on every model read, so `tx.policy.findFirst(...)` only ever saw the
//      CURRENT tenant's rows. A newly-active tenant (or a tenant-slug change
//      that re-keyed the per-tenant counter) therefore floored at the global
//      START_SEQ and re-issued an integer ANOTHER tenant already held — tripping
//      the global @unique constraint and leaving every paid policy in that
//      tenant PAID-but-never-issued (no INCEPTION, no docs, no welcome email).
//   2. `certificateNumber` is text, so `orderBy: { … : 'desc' }` sorted
//      LEXICOGRAPHICALLY and mis-ranked the max once values differed in length.
// Read the GLOBAL max with a raw query (raw SQL bypasses the model-level tenant
// extension) and cast to bigint so the ordering is NUMERIC. The `~ '^[0-9]+$'`
// predicate excludes non-numeric values such as the synthetic `CERT-PROOF-…`
// proof-run rows. The SQL is a fixed literal per field (no interpolation).
async function readMaxExistingNumericPolicyField(
  tx: Tx,
  field: 'certificateNumber' | 'greenCardSerial',
): Promise<string | null> {
  const sql =
    field === 'certificateNumber'
      ? `SELECT MAX("certificateNumber"::bigint)::text AS "max" FROM "policies" WHERE "certificateNumber" ~ '^[0-9]+$'`
      : `SELECT MAX("greenCardSerial"::bigint)::text AS "max" FROM "policies" WHERE "greenCardSerial" ~ '^[0-9]+$'`;
  const rows = await tx.$queryRawUnsafe<Array<{ max: string | null }>>(sql);
  return rows?.[0]?.max ?? null;
}

async function reserveNextNumericPolicyField(
  tx: Tx,
  key: string,
  field: 'certificateNumber' | 'greenCardSerial',
  startSeq: number,
) {
  const latestRaw = await readMaxExistingNumericPolicyField(tx, field);
  const latestText = String(latestRaw ?? '').trim();
  const latestSeq = /^\d+$/.test(latestText) ? Number(latestText) : NaN;
  const hasExistingFloor = Boolean(latestText) && Number.isSafeInteger(latestSeq) && latestSeq > 0;
  const floor = hasExistingFloor ? Math.max(startSeq, latestSeq) : startSeq;
  const seq = await reserveNext(tx, key, floor);
  if (!hasExistingFloor || seq > floor) return seq;
  await tx.policyNumberSequence.update({
    where: { key },
    data: { next: floor + 2 },
  });
  return floor + 1;
}

/**
 * Canonical quote / policy number formatter — single source of truth
 * for every customer-facing identifier (ADR-0034).
 *
 * Format: `<PREFIX>/<COUNTRY_CODE><7_DIGIT_SEQ>`
 *   ABQ/CY1000001  ABQ/PT1000001  ABQ/GR1000001  ABQ/ES1000001
 *   ABOLV/CY1000001  ABOLV/PT1000001  …
 *
 * The country code is read from the per-request operating tenant
 * (`getTenantConfig().countryCode`) — never hard-coded. Adding a new
 * tenant requires no change here.
 *
 * Pre-ADR-0034 CY rows keep their original format (`ABQ1000042`);
 * `reserveNextPolicyNumber` reads both the prefixed and the unprefixed
 * formats when seeding the floor so historical rows are not renamed.
 * New rows in every tenant — including CY — use the canonical
 * tenant-coded format.
 */
export function formatQuoteId(sequence: number, productType?: string | null) {
  if (sharedPlatformMode()) return formatPlatformReference('Q', sequence, productType);
  const cc = getTenantConfig().countryCode;
  const seq = String(sequence).padStart(7, '0');
  const scheme = getBrandedNumberScheme(productType, 'QUOTE');
  if (scheme) return scheme.format(cc, seq);
  return `${DEFAULT_QUOTE_PREFIX}/${cc}${seq}`;
}

export function formatPolicyId(sequence: number, productType?: string | null) {
  if (sharedPlatformMode()) return formatPlatformReference('P', sequence, productType);
  const cc = getTenantConfig().countryCode;
  const seq = String(sequence).padStart(7, '0');
  const scheme = getBrandedNumberScheme(productType, 'POLICY');
  if (scheme) return scheme.format(cc, seq);
  return `${DEFAULT_POLICY_PREFIX}/${cc}${seq}`;
}

/**
 * Canonical predicate: is `value` a reserved QUOTE identifier (any product,
 * any tenant, old ADR-0034 or ADR-0047 branded)? This is the single sanctioned
 * way to classify an identifier — ADR-0047 supersedes the previous
 * `startsWith('ABQ')` prefix check.
 */
export function isReservedQuoteId(value: unknown): boolean {
  const v = String(value ?? '').trim();
  if (PLATFORM_REFERENCE.exec(v)?.[1] === 'Q') return true;
  if (!v) return false;
  if (new RegExp(`^${DEFAULT_QUOTE_PREFIX}(/[A-Z]{2})?\\d+$`).test(v)) return true;
  return matchesBrandedNumber(v, 'QUOTE');
}

/**
 * Canonical predicate: is `value` a reserved issued-POLICY identifier (any
 * product, any tenant, old ADR-0034 or ADR-0047 branded)? See `isReservedQuoteId`.
 */
export function isReservedPolicyNumber(value: unknown): boolean {
  const v = String(value ?? '').trim();
  if (PLATFORM_REFERENCE.exec(v)?.[1] === 'P') return true;
  if (!v) return false;
  if (new RegExp(`^${DEFAULT_POLICY_PREFIX}(/[A-Z]{2})?\\d+$`).test(v)) return true;
  return matchesBrandedNumber(v, 'POLICY');
}

/**
 * Whether bind/issue/payment finalization should assign a fresh policy number
 * instead of retaining the row's current `policyNumber`.
 *
 * Quote ids (`ABQ/…`) are always upgraded. Any issued-policy identifier is
 * retained, including the historical ADR-0034 `ABOLV/…` namespace. BDX
 * imports use those identifiers as their bordereaux identity, and ADR-0047,
 * ADR-0061 and ADR-0071 explicitly forbid renaming existing rows as a side
 * effect of bind or issuance.
 */
export function shouldReassignPolicyNumberAtIssuance(
  productType: string | null | undefined,
  policyNumber: string | null | undefined,
): boolean {
  const product = String(productType || '').trim().toUpperCase();
  const num = String(policyNumber || '').trim();
  if (!num) return true;
  if (isReservedQuoteId(num)) return true;
  if (!product) return !isReservedPolicyNumber(num);

  if (isReservedPolicyNumber(num)) return false;
  // Lloyd's / BDX home imports use other `BZ/…` shapes (e.g. `BZ/ABG/…`) that
  // predate ADR-0071 `BZ/<CC><SEQ>` — retain them as their imported identity.
  if (product === 'HOME' && /^BZ\//i.test(num)) return false;
  return true;
}

export async function reserveNextQuoteId(tx: Tx, productType?: string | null) {
  if (sharedPlatformMode()) return formatQuoteId(await reservePlatformSequence(tx, 'QUOTE'), productType);
  const scheme = getBrandedNumberScheme(productType, 'QUOTE');
  const seq = scheme
    ? await reserveNextBrandedNumber(tx, tenantSequenceKey('QUOTE', scheme.keySuffix), scheme)
    : await reserveNextPolicyNumber(tx, tenantSequenceKey('QUOTE', DEFAULT_QUOTE_PREFIX), DEFAULT_QUOTE_PREFIX, defaultStartSeqForTenant());
  return formatQuoteId(seq, productType);
}

/**
 * Reserve the next issued-policy number. `origin` (ADR-0061) selects the
 * Motor/Santam stream — `ONLINE` (customer paid online) vs `MANUAL` (operator
 * entered) — which run on independent counters with different start sequences.
 * Products without an origin-split scheme ignore it, so the default is safe.
 */
export async function reserveNextPolicyId(
  tx: Tx,
  productType?: string | null,
  origin: IssueOrigin = 'ONLINE',
) {
  if (sharedPlatformMode()) return formatPolicyId(await reservePlatformSequence(tx, 'POLICY'), productType);
  const scheme = getBrandedNumberScheme(productType, 'POLICY', origin);
  const seq = scheme
    ? await reserveNextBrandedNumber(tx, tenantSequenceKey('POLICY', scheme.keySuffix), scheme)
    : await reserveNextPolicyNumber(tx, tenantSequenceKey('POLICY', DEFAULT_POLICY_PREFIX), DEFAULT_POLICY_PREFIX, defaultStartSeqForTenant());
  return formatPolicyId(seq, productType);
}

export function formatCertificateNumber(sequence: number) {
  return String(sequence);
}

export async function reserveNextCertificateNumber(tx: Tx) {
  if (sharedPlatformMode()) return formatCertificateNumber(await reservePlatformSequence(tx, 'CERTIFICATE'));
  const seq = await reserveNextNumericPolicyField(
    tx,
    tenantSequenceKey('CERTIFICATE', getTenantConfig().countryCode),
    'certificateNumber',
    CERTIFICATE_START_SEQ,
  );
  return formatCertificateNumber(seq);
}

export function formatGreenCardSerial(sequence: number) {
  return String(sequence);
}

export async function reserveNextGreenCardSerial(tx: Tx) {
  if (sharedPlatformMode()) return formatGreenCardSerial(await reservePlatformSequence(tx, 'GREENCARD'));
  const seq = await reserveNextNumericPolicyField(
    tx,
    tenantSequenceKey('GREENCARD', getTenantConfig().countryCode),
    'greenCardSerial',
    GREEN_CARD_SERIAL_START_SEQ,
  );
  return formatGreenCardSerial(seq);
}

export function formatClaimNumber(args: { year: number; sequence: number }) {
  const seq = String(args.sequence).padStart(4, '0');
  return `CLM-${args.year}-${seq}`;
}

export async function reserveNextClaimNumber(tx: Tx, at: Date = new Date()) {
  const year = at.getFullYear();
  const seq = await reserveNext(tx, tenantSequenceKey('CLAIM', String(year)), CLAIM_START_SEQ);
  return formatClaimNumber({ year, sequence: seq });
}

export async function generateQuoteId(productType?: string | null) {
  return await runTenantScopedTransaction((tx) => reserveNextQuoteId(tx as unknown as Tx, productType));
}

export async function generatePolicyId(productType?: string | null, origin: IssueOrigin = 'ONLINE') {
  return await runTenantScopedTransaction((tx) => reserveNextPolicyId(tx as unknown as Tx, productType, origin)); // TODO(FAC-9035): owner=platform-tenant expires=2026-12-31 deletionPR=typed-tenant-tx tenantScopedPrisma extension tx vs Tx union — pre-existing cast, identical to generateQuoteId above.
}

/** Transaction-bound idempotent assignment. Lock and reread the actual scoped row,
 * so concurrent bind/issue retries never allocate a second number or certificate.
 * Issued/imported references are immutable; only quote/temporary references upgrade. */
export async function assignPlatformIssuanceIdentifiers(tx: Prisma.TransactionClient, policyId: string, origin: IssueOrigin, includeCertificate = true): Promise<{ policyNumber: string; certificateNumber: string | null }> {
  if (!sharedPlatformMode()) throw new Error('Platform identifier assignment requires shared platform mode.');
  const tenant = getTenantConfig();
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM policies WHERE id = ${policyId} AND "operatingTenantId" = ${tenant.id} FOR UPDATE`;
  if (rows.length !== 1) throw new Error('Policy not found in the active operating tenant.');
  const policy = await tx.policy.findFirstOrThrow({ where: { id: policyId, operatingTenantId: tenant.id }, select: { policyNumber: true, certificateNumber: true, productType: true, issuedAt: true, status: true } });
  if (!policy.productType) throw new Error('Policy product is required before assigning identifiers.');
  const alreadyIssued = Boolean(policy.issuedAt) || ['ISSUED', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'LAPSED'].includes(policy.status.toUpperCase());
  const policyNumber = !alreadyIssued && shouldReassignPolicyNumberAtIssuance(policy.productType, policy.policyNumber)
    ? await reserveNextPolicyId(tx, policy.productType, origin) : policy.policyNumber;
  const certificateNumber = policy.certificateNumber || (!alreadyIssued && includeCertificate ? await reserveNextCertificateNumber(tx) : null);
  if (policyNumber !== policy.policyNumber || certificateNumber !== policy.certificateNumber) await tx.policy.update({ where: { id: policyId }, data: { policyNumber, certificateNumber } });
  return { policyNumber, certificateNumber };
}
