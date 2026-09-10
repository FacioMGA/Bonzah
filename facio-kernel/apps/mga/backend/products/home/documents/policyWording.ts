import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Canonical owner of the Home policy-wording selection.
 *
 * The Lloyd's Home wording that must be attached (and referenced on the
 * schedule) is a function of TWO dimensions:
 *   1. the operating tenant's territory (Cyprus, Portugal, …), and
 *   2. the client's domicile — a UK-domiciled proposer is written on a
 *      different Lloyd's wording than a locally-domiciled proposer.
 *
 * Before ADR-0048 the Home doc pack hardcoded the single
 * Cyprus (non-UK) wording for every tenant and every domicile, so a
 * Portugal policyholder received the Cyprus wording. This module makes
 * the selection explicit and data-driven — no `if (country === …)`
 * branches in document code (jurisdiction-product-config contract), and
 * no silent fallback to Cyprus (no-defensive-fallbacks): an
 * unconfigured territory throws.
 *
 * Assets live under the product folder (`documents/static`) per CHAMPS
 * canonical-ownership; the `filename` is the customer-facing download
 * name and the `reference` is the wording version printed on the
 * schedule (`{{policyWording}}`), taken verbatim from each PDF's cover.
 */

const HOME_STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');

export type HomeWordingDomicile = 'UK' | 'NON_UK';

export interface HomePolicyWording {
  /** Customer-facing download filename. */
  filename: string;
  /** Absolute path to the product-owned static PDF asset. */
  staticPdfPath: string;
  /** Wording version reference printed on the schedule, verbatim from the PDF cover. */
  reference: string;
  /** Unique asset version for the Document.templateVersion suffix. */
  assetVersion: string;
}

type HomeWordingPair = Record<HomeWordingDomicile, HomePolicyWording>;

// Greece Home wordings — domicile-aware (ADR-0073). Greece has TWO
// distinct Lloyd's/Beazley wordings (verbatim references from each PDF
// cover), matching the abbeygate.gr policy-documents portal: a UK-domiciled
// wording and a Greece-domiciled wording. This supersedes the previous single
// stale `CH/ABG/11.2020/CY/V1` Cyprus-referenced 2020 asset.
const GR_HOME_WORDING_UK: HomePolicyWording = {
  filename: 'Home_Policy_Wording_Greece_UK_Domiciled.pdf',
  staticPdfPath: path.join(HOME_STATIC_DIR, 'Abbeygate_Home_Greece_UK_Domiciled.pdf'),
  reference: 'BZ/ABG/8.2026/GRUK',
  assetVersion: 'beazley-lloyds-home-policy-wording-greece-uk-domiciled:2026-08-19',
};

const GR_HOME_WORDING_NON_UK: HomePolicyWording = {
  filename: 'Home_Policy_Wording_Greece_Domiciled.pdf',
  staticPdfPath: path.join(HOME_STATIC_DIR, 'Abbeygate_Home_Greece_Domiciled.pdf'),
  reference: 'BZ/ABG/8.2026/GR',
  assetVersion: 'beazley-lloyds-home-policy-wording-greece-domiciled:2026-08-19',
};

/**
 * `(territory) → { UK, NON_UK }` wording matrix. Keyed by the tenant
 * `countryCode` (see `TenantConfig.countryCode`). Add a territory by
 * adding a row here plus its two PDFs under `documents/static` and the
 * runtime-artifact / startup-validation / Dockerfile / .gitignore
 * registrations. There is deliberately no default row.
 */
const HOME_POLICY_WORDINGS: Readonly<Record<string, HomeWordingPair>> = {
  CY: {
    UK: {
      filename: 'Home_Policy_Wording_Cyprus_UK_Domiciled.pdf',
      staticPdfPath: path.join(
        HOME_STATIC_DIR,
        'LloydsHomePolicyWordingCyprus(UKDomiciled)_2024.pdf',
      ),
      reference: 'BZ/ABG/8.2026/CYUK',
      assetVersion: 'beazley-lloyds-home-policy-wording-cyprus-uk-domiciled:2026-08-19',
    },
    NON_UK: {
      filename: 'Home_Policy_Wording_Cyprus_Domiciled.pdf',
      staticPdfPath: path.join(
        HOME_STATIC_DIR,
        'Beazley_Lloyds_Home_Policy_Wording_Cyprus_(CyprusDomiciled).pdf',
      ),
      reference: 'BZ/ABG/8.2026/CY',
      assetVersion: 'beazley-lloyds-home-policy-wording-cyprus-domiciled:2026-08-19',
    },
  },
  PT: {
    UK: {
      filename: 'Home_Policy_Wording_Portugal_UK_Domiciled.pdf',
      staticPdfPath: path.join(
        HOME_STATIC_DIR,
        'Beazley_Home_Portugal_UK_Domiciled_Policy_Wording_Amended_Clean.pdf',
      ),
      reference: 'BZ/ABG/8.2026/PTUK',
      assetVersion: 'beazley-home-policy-wording-portugal-uk-domiciled:2026-08-19',
    },
    NON_UK: {
      filename: 'Home_Policy_Wording_Portugal_Domiciled.pdf',
      staticPdfPath: path.join(
        HOME_STATIC_DIR,
        'Beazley_Home_Portugal_Domiciled_Policy_Wording_Amended_Clean.pdf',
      ),
      reference: 'BZ/ABG/8.2026/PT',
      assetVersion: 'beazley-home-policy-wording-portugal-domiciled:2026-08-19',
    },
  },
  // Greece is domicile-aware like Cyprus/Portugal (ADR-0073): a UK-domiciled
  // proposer is written on `BZ/ABG/8.2026/GRUK` and a Greece-domiciled
  // proposer on `BZ/ABG/8.2026/GR`.
  GR: {
    UK: GR_HOME_WORDING_UK,
    NON_UK: GR_HOME_WORDING_NON_UK,
  },
};

export class HomePolicyWordingNotConfiguredError extends Error {
  readonly code = 'HOME_POLICY_WORDING_NOT_CONFIGURED' as const;
  readonly countryCode: string;
  constructor(countryCode: string) {
    super(
      `HOME_POLICY_WORDING_NOT_CONFIGURED: no Home policy wording is configured for territory '${countryCode || 'UNKNOWN'}'. ` +
        "Add the UK + non-UK Lloyd's wordings to backend/products/home/documents/static and register them in " +
        'HOME_POLICY_WORDINGS before this tenant can issue Home policies. The pipeline refuses to fall back to another ' +
        "territory's wording (ADR-0048).",
    );
    this.name = 'HomePolicyWordingNotConfiguredError';
    this.countryCode = countryCode;
  }
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when a domicile country string denotes the United Kingdom. The
 * canonical Nationality contract stores `"United Kingdom"`; `uk` / `u.k.`
 * are the documented aliases the validation package itself recognises
 * (`packages/validation/src/rules-pure.ts`).
 */
export function isUkDomicileCountry(country: unknown): boolean {
  const compact = normalize(country).replace(/\s+/g, '');
  return compact === 'unitedkingdom' || compact === 'uk';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/**
 * Domicile dimension for wording selection. Per the product decision the
 * wording follows the PRIMARY insured's domicile only (`proposer`); the
 * domicile of any joint policyholders does not change the wording.
 */
export function resolveHomeWordingDomicile(quoteData: unknown): HomeWordingDomicile {
  const qd = asRecord(quoteData);
  const proposer = asRecord(qd.proposer);
  return isUkDomicileCountry(proposer.domicileCountry) ? 'UK' : 'NON_UK';
}

/**
 * Resolve the Home policy wording for a tenant territory + domicile.
 * Throws `HomePolicyWordingNotConfiguredError` for unconfigured
 * territories rather than defaulting to another country's wording.
 */
export function resolveHomePolicyWording(
  countryCode: string,
  domicile: HomeWordingDomicile,
): HomePolicyWording {
  const pair = HOME_POLICY_WORDINGS[String(countryCode || '').toUpperCase()];
  if (!pair) throw new HomePolicyWordingNotConfiguredError(countryCode);
  return pair[domicile];
}

/** Every configured wording asset — used by startup / CI artifact checks. */
export function listHomePolicyWordingAssets(): HomePolicyWording[] {
  return Object.values(HOME_POLICY_WORDINGS).flatMap((pair) => [pair.UK, pair.NON_UK]);
}

// ---------------------------------------------------------------------------
// IPID (Insurance Product Information Document) — territory-aware (ADR-0048)
// ---------------------------------------------------------------------------
// The IPID does not vary by domicile. Cyprus and Greece share the approved
// Beazley IPID with subsidence; Portugal uses the Spain/Portugal IPID.

export interface HomeIpidAsset {
  filename: string;
  staticPdfPath: string;
  assetVersion: string;
}

const HOME_IPID_CYPRUS_GREECE_COMBINED: HomeIpidAsset = {
  filename: 'Home_IPID_Beazley_Cyprus_Greece_2023.pdf',
  staticPdfPath: path.join(HOME_STATIC_DIR, 'BeazleyHome_IPID_CyprusGreeceWithSubsidence2023.pdf'),
  assetVersion: 'beazley-home-ipid-cyprus-greece-with-subsidence:2023:80268fd8f4530858',
};

const HOME_IPID_SPAIN_PORTUGAL: HomeIpidAsset = {
  filename: 'Home_IPID_Beazley_Spain_Portugal.pdf',
  staticPdfPath: path.join(HOME_STATIC_DIR, 'BeazleyHome_IPID_SpainAndPortugal.pdf'),
  // Immutable SHA of the source PDF supplied in the 31 Aug 2026 Home
  // Insurance email. This makes a replacement document an explicit,
  // reviewed product-configuration change rather than a silent overwrite.
  assetVersion: 'beazley-home-ipid-spain-portugal:9299bf6cf380c105',
};

const HOME_IPIDS: Readonly<Record<string, HomeIpidAsset>> = {
  CY: HOME_IPID_CYPRUS_GREECE_COMBINED,
  PT: HOME_IPID_SPAIN_PORTUGAL,
  GR: HOME_IPID_CYPRUS_GREECE_COMBINED,
};

export class HomeIpidNotConfiguredError extends Error {
  readonly code = 'HOME_IPID_NOT_CONFIGURED' as const;
  readonly countryCode: string;
  constructor(countryCode: string) {
    super(
      `HOME_IPID_NOT_CONFIGURED: no Home IPID is configured for territory '${countryCode || 'UNKNOWN'}'. ` +
        'Add the IPID to backend/products/home/documents/static and register it in HOME_IPIDS before this tenant ' +
        'can issue Home policies (ADR-0048).',
    );
    this.name = 'HomeIpidNotConfiguredError';
    this.countryCode = countryCode;
  }
}

/**
 * Resolve the Home IPID for a tenant territory. Throws
 * `HomeIpidNotConfiguredError` for unconfigured territories rather than
 * defaulting to another country's IPID.
 */
export function resolveHomeIpid(countryCode: string): HomeIpidAsset {
  const ipid = HOME_IPIDS[String(countryCode || '').toUpperCase()];
  if (!ipid) throw new HomeIpidNotConfiguredError(countryCode);
  return ipid;
}

/** Every configured IPID asset — used by startup / CI artifact checks. */
export function listHomeIpidAssets(): HomeIpidAsset[] {
  return [...new Set(Object.values(HOME_IPIDS))];
}
