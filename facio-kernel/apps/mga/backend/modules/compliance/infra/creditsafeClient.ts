import { z } from 'zod';

const authResponseSchema = z.object({
  token: z.string().min(1),
});

/**
 * The POST /searches/individuals response is search *metadata* only —
 * `totalHitCount` is the canonical count field (the legacy `hitCount` is
 * absent in v1 Connect). Actual hit rows are fetched via the dedicated
 * `/hits` endpoint (see `fetchIndividualSearchHits`).
 */
const creditsafeResponseSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  riskRating: z.string().optional(),
  hitCount: z.number().optional(),
  totalHitCount: z.number().optional(),
  hits: z.array(z.unknown()).optional(),
});

export type CreditsafeSearchResponse = z.infer<typeof creditsafeResponseSchema> & Record<string, unknown>;

/**
 * `GET /searches/individuals/{searchId}/hits` wraps the array under
 * `items` with an outer `totalSize`. Older docs reference `hits` and
 * `data` — we accept any of the three to stay forward-compatible.
 */
const hitsResponseSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).optional(),
  hits: z.array(z.record(z.string(), z.unknown())).optional(),
  data: z.array(z.record(z.string(), z.unknown())).optional(),
  totalSize: z.number().optional(),
});

export type CreditsafeHitRow = Record<string, unknown>;

const downloadResponseSchema = z.object({
  downloadUrl: z.string().min(1),
  fileName: z.string().min(1),
  expiresAt: z.string().optional(),
  searchId: z.string().optional(),
});

export type CreditsafeDownloadResponse = z.infer<typeof downloadResponseSchema>;

export class CreditsafeHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CreditsafeHttpError';
    this.status = status;
  }
}

/**
 * Attach a truncated response body to an error message. Creditsafe returns a
 * JSON `{ message: ... }` on 4xx (e.g. exhausted credits, suspended account,
 * malformed search) — without it a `creditsafe_*_failed:400` is undiagnosable,
 * which is exactly what stalled the Aug 2026 fail-closed outage triage.
 */
function bodySnippet(text: string): string {
  const t = (text || '').trim();
  return t ? ` ${t.slice(0, 300)}` : '';
}

export function isTransientCreditsafeError(error: unknown): boolean {
  if (error instanceof CreditsafeHttpError) {
    return error.status === 429 || (error.status >= 500 && error.status < 600);
  }
  if (error instanceof Error) {
    const text = String(error.message || '').toLowerCase();
    return text.includes('timeout') || text.includes('network');
  }
  return false;
}

export class CreditsafeClient {
  private token: string | null = null;
  private tokenExpiresAtMs = 0;

  constructor(
    private readonly cfg: {
      baseUrl: string;
      username: string;
      password: string;
      timeoutMs: number;
      tokenTtlMs: number;
    }
  ) {}

  private async authenticate(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAtMs) return this.token;

    const response = await fetch(`${this.cfg.baseUrl}/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.cfg.username,
        password: this.cfg.password,
      }),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new CreditsafeHttpError(`creditsafe_auth_failed:${response.status}${bodySnippet(body)}`, response.status);
    }

    const payload = authResponseSchema.parse(await response.json());
    this.token = payload.token;
    this.tokenExpiresAtMs = Date.now() + this.cfg.tokenTtlMs;
    return this.token;
  }

  async searchIndividuals(body: Record<string, unknown>): Promise<CreditsafeSearchResponse> {
    const token = await this.authenticate();
    const response = await fetch(`${this.cfg.baseUrl}/compliance/kyc-protect/searches/individuals`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new CreditsafeHttpError(`creditsafe_search_failed:${response.status}${bodySnippet(rawText)}`, response.status);
    }
    const parsedRaw: unknown = rawText ? JSON.parse(rawText) : {};

    return creditsafeResponseSchema.passthrough().parse(parsedRaw) as CreditsafeSearchResponse;
  }

  /**
   * Fetch the hit rows for a previously executed individual AML search.
   * Required because Creditsafe's POST search response is metadata-only —
   * the actual hit details (name, hitScore, datasets, datesOfBirth,
   * countries, pepTier, etc.) live behind this GET.
   *
   * Returns the raw hit objects; the provider (CreditsafeSanctionsProvider)
   * is responsible for projecting them into the canonical
   * `SanctionFirstHit` shape.
   */
  async fetchIndividualSearchHits(searchId: string): Promise<CreditsafeHitRow[]> {
    const token = await this.authenticate();
    const url = `${this.cfg.baseUrl}/compliance/kyc-protect/searches/individuals/${encodeURIComponent(searchId)}/hits`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    const rawText = await response.text();
    if (!response.ok) {
      throw new CreditsafeHttpError(`creditsafe_hits_fetch_failed:${response.status}${bodySnippet(rawText)}`, response.status);
    }
    const parsedRaw: unknown = rawText ? JSON.parse(rawText) : {};
    const parsed = hitsResponseSchema.passthrough().parse(parsedRaw);
    return parsed.items ?? parsed.hits ?? parsed.data ?? [];
  }

  /**
   * Resolve a temporary signed URL for the PDF report of a previously
   * executed individual AML search. Per Creditsafe docs (POST
   * /compliance/kyc-protect/searches/individuals/{searchId}/download) the
   * caller must supply the array of hit ids to be included in the report.
   *
   * Returns `{ downloadUrl, fileName, expiresAt, searchId }`. The URL is
   * short-lived — callers must immediately stream the binary via
   * `fetchPdfBinary` and persist it; do not surface this URL to BO users.
   */
  async requestIndividualSearchPdf(
    searchId: string,
    hitIds: string[]
  ): Promise<CreditsafeDownloadResponse> {
    const token = await this.authenticate();
    const url = `${this.cfg.baseUrl}/compliance/kyc-protect/searches/individuals/${encodeURIComponent(searchId)}/download`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(hitIds),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new CreditsafeHttpError(`creditsafe_pdf_request_failed:${response.status}${bodySnippet(rawText)}`, response.status);
    }
    const parsedRaw: unknown = rawText ? JSON.parse(rawText) : {};
    return downloadResponseSchema.parse(parsedRaw);
  }

  /**
   * Stream a Creditsafe-issued signed download URL into a Buffer. Uses the
   * client's configured timeout. Throws `CreditsafeHttpError` on non-2xx so
   * the calling service's `isTransientCreditsafeError` retry classifier
   * applies uniformly.
   */
  async fetchPdfBinary(downloadUrl: string): Promise<Buffer> {
    const response = await fetch(downloadUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new CreditsafeHttpError(`creditsafe_pdf_download_failed:${response.status}${bodySnippet(body)}`, response.status);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
