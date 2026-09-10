import type {
  DownloadIndividualSearchPdfInput,
  SanctionPdfReport,
  SanctionSearchProvider,
  SearchIndividualInput,
} from '../domain/sanctionsProvider.js';
import type { SanctionFirstHit, SanctionSearchResult } from '../domain/sanctionsTypes.js';
import type { CreditsafeClient, CreditsafeHitRow, CreditsafeSearchResponse } from './creditsafeClient.js';

export const DEFAULT_BLOCKING_DATASETS = [
  'SAN-CURRENT',
  'SAN-FORMER',
  'PEP-CURRENT',
  'PEP-FORMER',
  'PEP-LINKED',
  'AM',
  'ENF',
  'POI',
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Pick the first non-empty string from a list. Returns '' rather than null
 * because the projection target (`SanctionFirstHit`) treats empty strings
 * as "no value" in the BO renderer (`SanctionsHitRow.tsx`).
 */
function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function firstStringFromArray(value: unknown): string {
  if (!Array.isArray(value)) return '';
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) return entry.trim();
  }
  return '';
}

function stringsFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string | number =>
        (typeof entry === 'string' && entry.trim().length > 0) ||
        (typeof entry === 'number' && Number.isFinite(entry))
      )
      .map((entry) => String(entry).trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  return [];
}

function joinStrings(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => String(entry).trim())
      .join(', ');
  }
  if (typeof value === 'string') return value.trim();
  return '';
}

function pickHitId(record: Record<string, unknown>): string {
  // Creditsafe's GET /hits returns the hit identifier on `id`. We also
  // tolerate the older `hitId` / `supplierHitId` shapes so this provider
  // keeps working if a tenant is pinned to an earlier API version.
  return firstNonEmptyString([record.id, record.hitId, record.supplierHitId]);
}

function pickMatchScore(record: Record<string, unknown>): number | null {
  // Real Creditsafe response uses `hitScore` (0-100). Legacy / docs samples
  // sometimes show `matchScore` / `score`; accept all three.
  for (const key of ['hitScore', 'matchScore', 'score', 'matchPercent']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function pickName(record: Record<string, unknown>): string {
  const direct = firstNonEmptyString([record.name, record.match, record.fullName, record.displayName]);
  if (direct) return direct;
  const profile = asRecord(record.profile);
  const first = firstNonEmptyString([record.firstName, profile.firstName]);
  const middle = firstNonEmptyString([record.middleName, profile.middleName]);
  const last = firstNonEmptyString([record.lastName, profile.lastName]);
  return [first, middle, last].filter(Boolean).join(' ').trim();
}

function pickCountry(record: Record<string, unknown>): string {
  const fromArray = firstStringFromArray(record.countries);
  if (fromArray) return fromArray.toUpperCase();
  const direct = firstNonEmptyString([
    record.country,
    record.countryCode,
    record.nationality,
    asRecord(record.profile).country,
  ]);
  return direct ? direct.toUpperCase() : '';
}

function pickDob(record: Record<string, unknown>): string {
  // Real response field: `datesOfBirth: string[]`. Accept the singular
  // shape too for backward compatibility.
  const fromArray = firstStringFromArray(record.datesOfBirth);
  if (fromArray) return fromArray;
  return firstNonEmptyString([record.dateOfBirth, record.dob, asRecord(record.profile).dateOfBirth]);
}

function pickAllDobs(record: CreditsafeHitRow): string[] {
  const profile = asRecord(record.profile);
  return [
    ...stringsFromUnknown(record.datesOfBirth),
    ...stringsFromUnknown(record.dateOfBirth),
    ...stringsFromUnknown(record.dob),
    ...stringsFromUnknown(profile.datesOfBirth),
    ...stringsFromUnknown(profile.dateOfBirth),
  ];
}

function pickGender(record: Record<string, unknown>): string {
  const raw = firstNonEmptyString([record.gender, asRecord(record.profile).gender]);
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function pickPepTier(record: Record<string, unknown>): string {
  const direct = firstNonEmptyString([record.pepTier, asRecord(record.profile).pepTier]);
  if (direct) return direct;
  return joinStrings(record.pepTiers);
}

/**
 * The screenshot's "Reason Listed" column collapses every dataset the hit
 * appears in (e.g. "PEP-CURRENT, AM, SAN-CURRENT"). On the live API this
 * is the `datasets` array on each hit row; older API surfaces used
 * `reasonsListed` / `reasonListed` either as arrays or comma-joined
 * strings — we accept all three.
 */
function pickReasons(record: Record<string, unknown>): string {
  const datasets = joinStrings(record.datasets ?? asRecord(record.profile).datasets);
  if (datasets) return datasets;
  return joinStrings(record.reasonsListed ?? record.reasonListed);
}

function pickDatasetCodes(record: CreditsafeHitRow): string[] {
  const profile = asRecord(record.profile);
  return [
    ...stringsFromUnknown(record.datasets ?? profile.datasets),
    ...stringsFromUnknown(record.reasonsListed),
    ...stringsFromUnknown(record.reasonListed),
  ].map((entry) => entry.toUpperCase());
}

function normaliseDateText(value: string): string {
  return value.trim();
}

function dobMatchesSubject(record: CreditsafeHitRow, subjectDob?: string): boolean {
  if (!subjectDob) return false;
  const normalisedSubjectDob = normaliseDateText(subjectDob);
  return pickAllDobs(record).some((dob) => normaliseDateText(dob) === normalisedSubjectDob);
}

function hasBlockingDataset(record: CreditsafeHitRow, blockingDatasets: Set<string>): boolean {
  return pickDatasetCodes(record).some((dataset) => blockingDatasets.has(dataset));
}

/**
 * Map a single Creditsafe `/hits` item into the canonical
 * `SanctionFirstHit` projection shown in the BO premium + underwriting
 * tabs. Returns undefined when the row lacks a stable identifier — that's
 * a malformed hit and we'd rather hide the row than render junk.
 */
function projectHit(record: Record<string, unknown>): SanctionFirstHit | undefined {
  const hitId = pickHitId(record);
  if (!hitId) return undefined;
  return {
    matchScore: pickMatchScore(record),
    name: pickName(record),
    country: pickCountry(record),
    dateOfBirth: pickDob(record),
    gender: pickGender(record),
    pepTier: pickPepTier(record),
    reasonsListed: pickReasons(record),
    hitId,
    hitIdsAll: [hitId],
  };
}

/**
 * Choose the top hit (highest hitScore) from a list and attach the full
 * `hitIdsAll` so the downstream PDF download endpoint can request a
 * report covering every match in the search.
 */
function rankAndProject(hits: CreditsafeHitRow[]): SanctionFirstHit | undefined {
  if (hits.length === 0) return undefined;
  const records = hits.map((entry) => asRecord(entry));
  const ranked = records
    .map((record) => ({ record, score: pickMatchScore(record) }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const top = ranked[0]?.record ?? records[0];
  const projected = projectHit(top);
  if (!projected) return undefined;
  const allHitIds = records.map((record) => pickHitId(record)).filter((id) => Boolean(id));
  return { ...projected, hitIdsAll: allHitIds };
}

function totalHitCount(response: CreditsafeSearchResponse): number {
  if (typeof response.totalHitCount === 'number') return response.totalHitCount;
  if (typeof response.hitCount === 'number') return response.hitCount;
  if (Array.isArray(response.hits)) return response.hits.length;
  return 0;
}

export class CreditsafeSanctionsProvider implements SanctionSearchProvider {
  constructor(
    private readonly client: CreditsafeClient,
    private readonly cfg: {
      threshold: 75 | 80 | 85 | 90 | 95 | 100;
      datasets: string[];
      blockingDatasets?: string[];
    }
  ) {}

  async searchIndividual(input: SearchIndividualInput): Promise<SanctionSearchResult> {
    const request: Record<string, unknown> = {
      name: input.name,
      threshold: this.cfg.threshold,
      datasets: this.cfg.datasets,
    };
    // Screen by name + DOB. `countryCodes` is intentionally NOT sent: it
    // filters the AML search and over-narrows results (ADR-0043). DOB is
    // forwarded only when the caller resolved a valid value; otherwise the
    // search runs name-only, which Creditsafe supports.
    if (input.dateOfBirth) request.dateOfBirth = input.dateOfBirth;

    const response = await this.client.searchIndividuals(request);
    const responseRecord = response as Record<string, unknown>;
    const hitCount = totalHitCount(response);
    const hasHits = hitCount > 0;
    const searchId = response.id;
    if (hasHits && !searchId) {
      return {
        provider: 'creditsafe',
        outcome: 'error',
        blocking: true,
        hitCount,
        providerStatus: response.status,
        providerRiskRating: response.riskRating,
        raw: { search: responseRecord, hits: [] },
      };
    }

    // Hit rows live behind a second GET. We only spend the roundtrip when
    // there are hits to project — clean searches don't need the call.
    let firstHit: SanctionFirstHit | undefined;
    let hitsSnapshot: CreditsafeHitRow[] = [];
    let blocking = false;
    if (hasHits && searchId) {
      hitsSnapshot = await this.client.fetchIndividualSearchHits(searchId);
      const blockingDatasets = new Set(
        (this.cfg.blockingDatasets ?? [...DEFAULT_BLOCKING_DATASETS])
          .map((dataset) => dataset.trim().toUpperCase())
          .filter(Boolean)
      );
      const qualifyingHits = hitsSnapshot.filter((entry) => {
        const record = asRecord(entry);
        return dobMatchesSubject(record, input.dateOfBirth) && hasBlockingDataset(record, blockingDatasets);
      });
      blocking = qualifyingHits.length > 0;
      firstHit = rankAndProject(blocking ? qualifyingHits : hitsSnapshot);
    }

    return {
      provider: 'creditsafe',
      providerSearchId: searchId,
      outcome: blocking ? 'possible_match' : hasHits ? 'non_blocking_hit' : 'clear',
      blocking,
      hitCount,
      providerStatus: response.status,
      providerRiskRating: response.riskRating,
      firstHit,
      // Persist BOTH the metadata response (top level) and the resolved
      // hits array so the audit JSON in `SanctionScreeningRun.responseJson`
      // is fully self-describing — no compliance officer should ever have
      // to re-hit Creditsafe to reconstruct what the run saw.
      raw: { search: responseRecord, hits: hitsSnapshot },
    };
  }

  async downloadIndividualSearchPdf(
    input: DownloadIndividualSearchPdfInput
  ): Promise<SanctionPdfReport | null> {
    if (!input.searchId || input.hitIds.length === 0) return null;
    const metadata = await this.client.requestIndividualSearchPdf(input.searchId, input.hitIds);
    const buffer = await this.client.fetchPdfBinary(metadata.downloadUrl);
    const filename = metadata.fileName.toLowerCase().endsWith('.pdf')
      ? metadata.fileName
      : `${metadata.fileName}.pdf`;
    return { buffer, filename, mimeType: 'application/pdf' };
  }
}
