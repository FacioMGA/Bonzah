import { buildPublicSessionUrl } from '@/src/shared/lib/wizard/buildPublicSessionUrl';

type JsonRecord = Record<string, unknown> | null;

export const MOTOR_PUBLIC_PRODUCT_CODE = 'motor';

async function parseJson(response: Response): Promise<JsonRecord> {
  return (await response.json().catch(() => null)) as JsonRecord;
}

async function fetchJson(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: JsonRecord; retryAfter: string | null }> {
  try {
    const response = await fetch(input, init);
    return {
      ok: response.ok,
      status: response.status,
      json: await parseJson(response),
      retryAfter: response.headers.get('Retry-After'),
    };
  } catch {
    // ABY-443 / REACT-F — a dropped network (TypeError: Failed to fetch)
    // must not escape as an unhandled exception.
    return { ok: false, status: 0, json: null, retryAfter: null };
  }
}

function retryDelayMs(retryAfterHeader: string | null): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 5000);
  }
  return 1000;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export async function patchPublicSessionQuoteData(args: {
  policyId: string;
  quoteData: unknown;
  step: string;
}): Promise<{ ok: boolean; status: number; json: JsonRecord }> {
  const request = () =>
    fetchJson(buildPublicSessionUrl(MOTOR_PUBLIC_PRODUCT_CODE, args.policyId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteData: args.quoteData, step: args.step }),
    });
  let result = await request();
  if (result.status === 429) {
    await sleep(retryDelayMs(result.retryAfter));
    result = await request();
  }
  return { ok: result.ok, status: result.status, json: result.json };
}

export async function unlockPublicSession(policyId: string): Promise<{ ok: boolean; status: number; json: JsonRecord }> {
  return fetchJson(buildPublicSessionUrl(MOTOR_PUBLIC_PRODUCT_CODE, policyId, 'unlock'), { method: 'POST' });
}

export async function rateQuote(policyId: string, quoteData: unknown): Promise<{ ok: boolean; json: JsonRecord }> {
  const result = await fetchJson(buildPublicSessionUrl(MOTOR_PUBLIC_PRODUCT_CODE, policyId, 'rate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteData }),
  });
  return { ok: result.ok, json: result.json };
}

export async function forkPublicSession(policyId: string): Promise<{ ok: boolean; status: number; json: JsonRecord }> {
  return fetchJson(buildPublicSessionUrl(MOTOR_PUBLIC_PRODUCT_CODE, policyId, 'fork'), { method: 'POST' });
}

// Issue-readiness fetch was previously declared here as
// `getPublicIssueReadiness`; per canonical-ownership.md "Issue-readiness
// HTTP" row, it now lives in `@/src/shared/lib/wizard/issueReadinessClient.ts`
// (`fetchIssueReadinessRaw` / `fetchIssueReadinessForProduct`). Motor
// and PaymentStep both consume the shared client.

export async function getPublicSessionSummary(policyId: string): Promise<{ ok: boolean; json: JsonRecord }> {
  const result = await fetchJson(buildPublicSessionUrl(MOTOR_PUBLIC_PRODUCT_CODE, policyId));
  return { ok: result.ok, json: result.json };
}

export async function requestPublicQuoteCallback(args: {
  policyId: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: boolean; json: JsonRecord }> {
  const result = await fetchJson(buildPublicSessionUrl(MOTOR_PUBLIC_PRODUCT_CODE, args.policyId, 'request-callback'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args.payload),
  });
  return { ok: result.ok, json: result.json };
}
