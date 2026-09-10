export type ApiExchange = {
  id: string; startedAt: string; method: string; path: string;
  request: unknown; response: unknown; status: number; durationMs: number;
};

export const presenterSafeRequest = (body: string) => {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  if ('policyholder' in parsed) parsed.policyholder = '[redacted customer details]';
  if ('payment' in parsed) parsed.payment = '[redacted payment token]';
  return parsed;
};

/** Observe actual public adapter traffic; never collect authorization headers. */
export async function requestDemoApi<T>(path: string, init?: RequestInit, observe?: (entry: ApiExchange) => void): Promise<T> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const id = crypto.randomUUID();
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Correlation-Id', id);
  // The public production host resolves its tenant from the domain. Local Vite
  // runs on 127.0.0.1, so it supplies the seeded development tenant explicitly.
  if (import.meta.env.DEV) headers.set('X-Tenant-Slug', 'abbeygate-cy');
  let status = 0;
  let payload: unknown;
  try {
    const response = await fetch(`/api/public/bonzah${path}`, { ...init, headers });
    status = response.status;
    payload = await response.json();
    const body = payload as { data?: T; error?: { message?: string } };
    if (!response.ok || !body.data) throw new Error(body.error?.message || 'The protection service is unavailable.');
    return body.data;
  } catch (error) {
    if (payload === undefined) payload = { error: { message: error instanceof Error ? error.message : 'Request failed.' } };
    throw error;
  } finally {
    observe?.({ id, startedAt, method: init?.method || 'GET', path: `/api/public/bonzah${path}`,
      request: typeof init?.body === 'string' ? presenterSafeRequest(init.body) : null,
      response: payload, status, durationMs: Math.round(performance.now() - started) });
  }
}
