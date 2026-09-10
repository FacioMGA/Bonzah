/**
 * Canonical policy-list row view model.
 *
 * The BO `/policies` table row is a **Policy Summary Card** made of six
 * universal slots:
 *
 *   1. Risk / asset descriptor  (product-specific, declarative)
 *   2. Policyholder              (universal)
 *   3. Coverage                  (product-specific label + details + period)
 *   4. Lifecycle status          (universal)
 *   5. Premium                   (universal)
 *   6. Temporal metadata         (universal)
 *
 * Motor expresses slot (1) in a vehicle-centric way via manifest paths
 * over `quoteData` — the canonical source. The pre-`spine/v2` legacy
 * `vehicleInfo` / `vehicleDisplay` columns were merged into the
 * projection source for backward compatibility with rows written
 * before the `quoteData` refactor. That merge was deleted in Wave 5
 * of `spine/v2`: every modern motor write populates `quoteData`, and
 * historical rows that lack it degrade their list display rather than
 * preserving a fail-open path that masks gate failures elsewhere.
 *
 * The row component (`policyColumns.tsx`) should call
 * `buildPolicyListRowViewModel(policy)` once per row and render from
 * the returned VM. Adding a new product means updating its
 * `ProductManifest.summaryFields` + `listColumns` — no renderer changes.
 */

import type { ProductManifest } from '@facio/products';
import { ProductRegistry } from './registry';
import { buildRiskIdentityFromManifest } from './riskIdentity';
import { projectListColumn } from './listColumnRenderers';

export interface PolicyRowInput {
  id: string;
  policyNumber?: string;
  productType?: string;
  segment?: string;
  name?: string;
  insuredName?: string;

  status?: string;
  bo_status?: string | null;

  start?: string;
  end?: string;
  createdAt?: string;
  updatedAt?: string;

  premium?: number;
  currency?: string;
  totalPremium?: number;

  policyholderEmail?: string | null;
  policyholderPhone?: string | null;

  /** Full canonical quote data — the ONLY source the VM builder reads for risk/coverage. */
  quoteData?: unknown;
}

export interface PolicyListRowViewModel {
  /** What is being insured (product-specific projection, but universal shape). */
  riskSummary: {
    /** `vehicle` | `property` | `trip` | <future>. Comes from manifest.insuredObject.kind. */
    kind: string;
    /** Product-specific title, e.g. "Toyota Corolla 2020", "3-bedroom · Nicosia", "Worldwide Travel". */
    title: string;
    /** Secondary line: e.g. "Petrol · 1600", "Single Trip · 14 days". */
    subtitle?: string;
    /** Tertiary detail: insured value, rebuild cost, medical cover limit, etc. */
    detail?: string;
    /** Unique identifier for dense UIs: plate, VIN, passport, postcode. */
    identifier?: string;
  };

  policyholder: {
    name: string;
    email?: string;
    phone?: string;
  };

  coverage: {
    /** Coverage product name: "Comprehensive", "Single Trip", "Buildings + Contents". */
    name?: string;
    /** Coverage qualifier: "Standard (€250)", "€100 excess", "Silver plan". */
    details?: string;
    startDate?: string;
    endDate?: string;
  };

  status: {
    /** Normalised uppercase lifecycle status (e.g. `ACTIVE`, `QUOTED`). */
    rawStatus: string;
    /** Optional sub-label, e.g. "Offer ready", "Awaiting UW". */
    detail?: string;
    /** Business policy number — shown as a small footer next to the status pill. */
    policyNumber?: string;
  };

  premium: {
    amount: number;
    currency: string;
  };

  dates: {
    createdAt?: string;
    /** Greater of updatedAt / createdAt — what the UI calls "Last activity". */
    lastActivityAt?: string;
  };

  /** Product metadata useful for icons + empty states. */
  product: {
    productType: string;
    displayName: string;
    iconKey: string;
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Projection source for the manifest-driven row VM.
 *
 * Single source: `quoteData`. The previous `vehicleInfo` legacy merge
 * was deleted in `spine/v2` Wave 5 (see file-header note above).
 */
function projectionSource(input: PolicyRowInput): Record<string, unknown> {
  return asRecord(input.quoteData);
}

function pickStatus(input: PolicyRowInput): string {
  const raw = (input.bo_status ?? input.status ?? 'DRAFT');
  const base = String(raw || '').toUpperCase();
  // Soft normalisations identical to the previous renderer so downstream
  // consumers (icons, tone logic) see the same vocabulary.
  if (base === 'DATA_CAPTURE_IN_PROGRESS') return 'INTAKE';
  if (base === 'REFERRED') return 'REFERRAL';
  if (base === 'PAYMENT_FAILED') return 'AWAITING_PAYMENT';
  if (base === 'QUOTE') return 'QUOTED';
  return base;
}

function ISO(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  if (!s || s === 'N/A') return undefined;
  return s;
}

/**
 * Project a policy into the universal row view model.
 *
 * Returns null when no `ProductManifest` is registered for the policy's
 * productType — callers should render a "pending product" chip.
 */
export function buildPolicyListRowViewModel(input: PolicyRowInput): PolicyListRowViewModel | null {
  const manifest = input.productType ? ProductRegistry.get(input.productType) : null;
  if (!manifest) return null;

  const source = projectionSource(input);
  const identity = buildRiskIdentityFromManifest(manifest, source);
  const insuredProjection = projectListColumn(source, manifest.listColumns.insured);
  const coverageProjection = projectListColumn(source, manifest.listColumns.coverage);

  const fallbackTitle =
    input.insuredName || input.name || manifest.insuredObject.label.singular;
  const title =
    insuredProjection.primary
      || (identity.primary && identity.primary !== manifest.displayName
        ? identity.primary
        : String(fallbackTitle));
  const subtitle =
    insuredProjection.secondary
      || identity.secondary
      || undefined;
  const detail = insuredProjection.tertiary || undefined;

  const startDate = (() => {
    const built = typeof manifest.listColumns.coverage.buildStartDate === 'function'
      ? (manifest.listColumns.coverage.buildStartDate(source) || '').trim()
      : '';
    return ISO(built || input.start);
  })();
  const endDate = (() => {
    const built = typeof manifest.listColumns.coverage.buildEndDate === 'function'
      ? (manifest.listColumns.coverage.buildEndDate(source) || '').trim()
      : '';
    return ISO(built || input.end);
  })();
  const createdAt = ISO(input.createdAt);
  const updatedAt = ISO(input.updatedAt);

  const rawStatus = pickStatus(input);

  return buildRowVM({
    manifest,
    productType: String(input.productType).toUpperCase(),
    identity,
    title,
    subtitle,
    detail,
    coverageProjection,
    startDate,
    endDate,
    input,
    rawStatus,
    createdAt,
    updatedAt,
  });
}

/** Assemble the immutable VM. Split out so the builder stays a single pure function. */
function buildRowVM(args: {
  manifest: ProductManifest;
  productType: string;
  identity: ReturnType<typeof buildRiskIdentityFromManifest>;
  title: string;
  subtitle?: string;
  detail?: string;
  coverageProjection: ReturnType<typeof projectListColumn>;
  startDate?: string;
  endDate?: string;
  input: PolicyRowInput;
  rawStatus: string;
  createdAt?: string;
  updatedAt?: string;
}): PolicyListRowViewModel {
  const {
    manifest, productType, identity, title, subtitle, detail,
    coverageProjection, startDate, endDate, input, rawStatus, createdAt, updatedAt,
  } = args;

  return {
    riskSummary: {
      kind: manifest.insuredObject.kind,
      title,
      subtitle,
      detail,
      identifier: identity.identifier,
    },
    policyholder: {
      name: String(input.name || input.insuredName || '—'),
      email: input.policyholderEmail ? String(input.policyholderEmail) : undefined,
      phone: input.policyholderPhone ? String(input.policyholderPhone) : undefined,
    },
    coverage: {
      name: coverageProjection.primary || undefined,
      details: coverageProjection.secondary || coverageProjection.tertiary || undefined,
      startDate,
      endDate,
    },
    status: {
      rawStatus,
      detail: undefined, // caller computes with its own status-sub-label logic
      policyNumber: input.policyNumber ? String(input.policyNumber) : undefined,
    },
    premium: {
      amount: Number(input.premium || input.totalPremium || 0),
      currency: String(input.currency || 'EUR'),
    },
    dates: {
      createdAt,
      lastActivityAt: updatedAt || createdAt,
    },
    product: {
      productType,
      displayName: manifest.displayName,
      iconKey: manifest.theme.iconKey,
    },
  };
}
