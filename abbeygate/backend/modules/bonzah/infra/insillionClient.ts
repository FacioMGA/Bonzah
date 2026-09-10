export type InsillionJson = Record<string, unknown>;

export class InsillionProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 502,
    readonly providerErrors: string[] = [],
    readonly ambiguous = false,
  ) { super(message); }
}

type FetchLike = typeof fetch;
type RequestOptions = { retryAfterAuth?: boolean; mutation?: boolean };

const record = (value: unknown): InsillionJson => value && typeof value === 'object' && !Array.isArray(value) ? value as InsillionJson : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(String).filter(Boolean) : [];

export class InsillionClient {
  private token: { value: string; expiresAt: number } | null = null;
  private authentication: Promise<string> | null = null;
  private masterCache = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly config: { baseUrl: string; username: string; password: string; timeoutMs: number }, private readonly fetchImpl: FetchLike = fetch) {}

  private url(path: string): string { return `${this.config.baseUrl.replace(/\/+$/, '')}${path}`; }

  assertSandboxMutation(): void {
    if (this.config.baseUrl.replace(/\/+$/, '') !== 'https://bonzah.sb.insillion.com' || process.env.NODE_ENV === 'production') {
      throw new InsillionProviderError('PROVIDER_NOT_CONFIGURED', 'Live issuance is disabled until verified payment and durable operation storage are implemented.', 503);
    }
  }

  private async parse(response: Response): Promise<InsillionJson> {
    const raw = await response.text();
    try { return record(JSON.parse(raw)); }
    catch { throw new InsillionProviderError('PROVIDER_INVALID_RESPONSE', 'Insillion returned a non-JSON response.'); }
  }

  private providerFailure(body: InsillionJson, fallback: string): InsillionProviderError {
    const errors = strings(body.errors);
    const message = String(body.txt || errors[0] || fallback);
    return new InsillionProviderError('PROVIDER_REJECTED', message, 422, errors);
  }

  async authenticate(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (!force && this.authentication) return this.authentication;
    const pending = (async () => {
      let response: Response;
      try {
        response = await this.fetchImpl(this.url('/api/v1/auth'), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: this.config.username, pwd: this.config.password }),
          signal: AbortSignal.timeout(this.config.timeoutMs), redirect: 'error',
        });
      } catch {
        throw new InsillionProviderError('PROVIDER_UNAVAILABLE', 'Insillion authentication is unavailable.');
      }
      const body = await this.parse(response);
      if (!response.ok || Number(body.status) !== 0) throw this.providerFailure(body, 'Insillion authentication failed.');
      const value = String(record(body.data).token || body.token || '');
      if (!value) throw new InsillionProviderError('PROVIDER_INVALID_RESPONSE', 'Insillion authentication response did not include a token.');
      this.token = { value, expiresAt: Date.now() + 14 * 60_000 };
      return value;
    })();
    this.authentication = pending;
    try { return await pending; } finally { if (this.authentication === pending) this.authentication = null; }
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown, options: RequestOptions = {}): Promise<InsillionJson> {
    if (options.mutation) this.assertSandboxMutation();
    const send = async (token: string) => this.fetchImpl(this.url(path), {
      method, headers: { 'content-type': 'application/json', 'in-auth-token': token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.config.timeoutMs), redirect: 'error',
    });
    let response: Response;
    try { response = await send(await this.authenticate()); }
    catch (error) {
      if (error instanceof InsillionProviderError) throw error;
      throw new InsillionProviderError(
        options.mutation ? 'PROVIDER_RECONCILIATION_REQUIRED' : 'PROVIDER_UNAVAILABLE',
        options.mutation ? 'Insillion did not confirm the operation; reconciliation is required.' : 'Insillion is unavailable.',
        502, [], Boolean(options.mutation),
      );
    }
    if (response.status === 401 && options.retryAfterAuth) {
      this.token = null;
      try { response = await send(await this.authenticate(true)); }
      catch { throw new InsillionProviderError('PROVIDER_UNAVAILABLE', 'Insillion is unavailable.'); }
    }
    let payload: InsillionJson;
    try {
      payload = await this.parse(response);
      if (response.status >= 500 || payload.status === undefined || payload.status === null) throw new InsillionProviderError('PROVIDER_INVALID_RESPONSE', 'Insillion returned an invalid response.');
    } catch (error) {
      if (options.mutation) throw new InsillionProviderError('PROVIDER_RECONCILIATION_REQUIRED', 'Insillion did not confirm the operation; reconciliation is required.', 502, [], true);
      throw error;
    }
    if (!response.ok || Number(payload.status) !== 0) throw this.providerFailure(payload, `Insillion ${path} failed.`);
    return payload;
  }

  async master(body: { master_name: string; values: string; filter: string; filter_value: string }): Promise<unknown> {
    const key = JSON.stringify(body);
    const cached = this.masterCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const payload = await this.request('POST', '/api/v1/Bonzah/master', body, { retryAfterAuth: true });
    const value = payload.data;
    this.masterCache.set(key, { value, expiresAt: Date.now() + 24 * 60 * 60_000 });
    return value;
  }

  premium(body: InsillionJson): Promise<InsillionJson> {
    return this.request('POST', '/api/v1/Bonzah/premiumCalc', body, { retryAfterAuth: true });
  }

  finalizeQuote(body: InsillionJson): Promise<InsillionJson> {
    return this.request('POST', '/api/v1/Bonzah/quote', body, { mutation: true });
  }

  payment(body: { payment_id: string; amount: number }): Promise<InsillionJson> {
    return this.request('POST', '/api/v1/Bonzah/payment', body, { mutation: true });
  }

  policy(policyId: string): Promise<InsillionJson> {
    return this.request('GET', `/api/v1/Bonzah/policy?policy_id=${encodeURIComponent(policyId)}`, undefined, { retryAfterAuth: true });
  }

  async document(policyId: string, dataId: string): Promise<Response> {
    const send = async (token: string) => this.fetchImpl(this.url(`/api/v1/policy/data/${encodeURIComponent(policyId)}?data_id=${encodeURIComponent(dataId)}&download=1`), {
      method: 'GET', headers: { 'in-auth-token': token }, signal: AbortSignal.timeout(this.config.timeoutMs), redirect: 'error',
    });
    let response = await send(await this.authenticate());
    if (response.status === 401) { this.token = null; response = await send(await this.authenticate(true)); }
    if (!response.ok) throw new InsillionProviderError('PROVIDER_DOCUMENT_UNAVAILABLE', 'Insillion policy document is unavailable.', response.status);
    return response;
  }
}

let injectedClient: InsillionClient | null = null;
export function getInsillionClient(): InsillionClient {
  if (injectedClient) return injectedClient;
  const username = String(process.env.BONZAH_INSILLION_USERNAME || '').trim();
  const password = String(process.env.BONZAH_INSILLION_PASSWORD || '').trim();
  if (!username || !password) throw new InsillionProviderError('PROVIDER_NOT_CONFIGURED', 'Insillion credentials are not configured.', 503);
  injectedClient = new InsillionClient({
    baseUrl: String(process.env.BONZAH_INSILLION_BASE_URL || 'https://bonzah.sb.insillion.com'),
    username, password,
    timeoutMs: Number(process.env.BONZAH_INSILLION_TIMEOUT_MS || 10_000),
  });
  return injectedClient;
}

export function setInsillionClientForTests(client: InsillionClient | null): void { injectedClient = client; }
