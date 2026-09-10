import { operatingRequestHeaders } from '@/src/shared/lib/tenant/requestHeaders';
/**
 * Generic public quote session adapter factory.
 *
 * Each product instantiates one via `createSessionAdapter({ productCode: 'HOME' })`
 * and gets a typed client for `/api/public/:productCode/session/...`.
 *
 * Product-specific adapters can still wrap this for custom behavior, but the
 * public endpoint shape is `/api/public/:productCode/session/...` for all
 * products, including motor.
 */

export interface PublicSessionAdapter {
  create(seed?: { quoteData?: { [key: string]: unknown } }): Promise<{ ok: boolean; publicId: string | null; error?: string; errorCode?: string }>;
  load(token: string): Promise<{ ok: boolean; session: Record<string, unknown> | null; error?: string; errorCode?: string }>;
  patch(token: string, patch: Record<string, unknown>): Promise<{ ok: boolean; session: Record<string, unknown> | null; error?: string; errorCode?: string }>;
  rate(token: string): Promise<{ ok: boolean; quoteResponse: Record<string, unknown> | null; error?: string; errorCode?: string }>;
  issue(token: string): Promise<{ ok: boolean; policyId: string | null; error?: string; errorCode?: string }>;
  fork(token: string): Promise<{ ok: boolean; publicId: string | null; error?: string; errorCode?: string }>;
}

function baseUrl(productCode: string): string {
  const code = String(productCode || '').toLowerCase().trim();
  return `/api/public/${code}/session`;
}

async function safeJson(res: Response): Promise<unknown> {
  try { return await res.json(); } catch { return null; }
}

type ApiErrorObj = { message?: string; code?: string };
type ApiBody = { success?: boolean; error?: ApiErrorObj | string };

function pickErrorMessage(body: ApiBody | null | undefined): string | undefined {
  const err = body?.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') return err.message;
  return undefined;
}

function pickErrorCode(body: ApiBody | null | undefined): string | undefined {
  const err = body?.error;
  if (err && typeof err === 'object' && typeof err.code === 'string') return err.code;
  return undefined;
}

export function createSessionAdapter({ productCode }: { productCode: string }): PublicSessionAdapter {
  const url = baseUrl(productCode);

  return {
    async create(seed) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...operatingRequestHeaders() }, body: JSON.stringify(seed || {}) });
      const body = await safeJson(res) as (ApiBody & { data?: { publicSessionToken?: string; policyId?: string } }) | null;
      const publicId = body?.data?.publicSessionToken || body?.data?.policyId || null;
      return { ok: res.ok && Boolean(body?.success), publicId, error: pickErrorMessage(body), errorCode: pickErrorCode(body) };
    },
    async load(token) {
      const res = await fetch(`${url}/${encodeURIComponent(token)}`, { headers: operatingRequestHeaders() });
      const body = await safeJson(res) as (ApiBody & { data?: Record<string, unknown> }) | null;
      return { ok: res.ok && Boolean(body?.success), session: body?.data ?? null, error: pickErrorMessage(body), errorCode: pickErrorCode(body) };
    },
    async patch(token, patch) {
      const res = await fetch(`${url}/${encodeURIComponent(token)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...operatingRequestHeaders() }, body: JSON.stringify(patch) });
      const body = await safeJson(res) as (ApiBody & { data?: Record<string, unknown> }) | null;
      return { ok: res.ok && Boolean(body?.success), session: body?.data ?? null, error: pickErrorMessage(body), errorCode: pickErrorCode(body) };
    },
    async rate(token) {
      const res = await fetch(`${url}/${encodeURIComponent(token)}/rate`, { method: 'POST', headers: operatingRequestHeaders() });
      const body = await safeJson(res) as (ApiBody & { data?: Record<string, unknown> }) | null;
      return { ok: res.ok && Boolean(body?.success), quoteResponse: body?.data ?? null, error: pickErrorMessage(body), errorCode: pickErrorCode(body) };
    },
    async issue(token) {
      const res = await fetch(`${url}/${encodeURIComponent(token)}/issue`, { method: 'POST', headers: operatingRequestHeaders() });
      const body = await safeJson(res) as (ApiBody & { data?: { policyId?: string } }) | null;
      return { ok: res.ok && Boolean(body?.success), policyId: body?.data?.policyId ?? null, error: pickErrorMessage(body), errorCode: pickErrorCode(body) };
    },
    async fork(token) {
      const res = await fetch(`${url}/${encodeURIComponent(token)}/fork`, { method: 'POST', headers: operatingRequestHeaders() });
      const body = await safeJson(res) as (ApiBody & { data?: { publicSessionToken?: string } }) | null;
      return { ok: res.ok && Boolean(body?.success), publicId: body?.data?.publicSessionToken ?? null, error: pickErrorMessage(body), errorCode: pickErrorCode(body) };
    },
  };
}
