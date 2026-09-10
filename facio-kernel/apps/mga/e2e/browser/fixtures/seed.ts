/**
 * Deterministic seed helpers for tier 5 browser specs (ADR-0030).
 *
 * Per the tenancy contract: specs MUST resolve the CY test tenant
 * through the same path production uses (tenantResolution.ts), via
 * the seeded test tenant the `db:seed` job already provisions.
 * These helpers create per-spec public sessions / OTP fixtures
 * out-of-band without bypassing the surface boundary the customer
 * journey traverses.
 */

const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:8080';

export type ProductCode = 'motor' | 'home' | 'travel';

export type SeededSession = {
  productCode: ProductCode;
  publicSessionToken: string;
  policyId: string;
};

async function jsonRequest<TBody>(input: string, init?: RequestInit & { body?: TBody }): Promise<unknown> {
  const headers = { 'Content-Type': 'application/json', ...(init?.headers || {}) };
  const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;
  const res = await fetch(`${API_BASE_URL}${input}`, { ...init, headers, body });
  return res.ok ? res.json() : Promise.reject(new Error(`${input}: ${res.status}`));
}

export async function createPublicSession(productCode: ProductCode): Promise<SeededSession> {
  const json = (await jsonRequest(`/api/public/${productCode}/session`, {
    method: 'POST',
    body: {},
  })) as { data?: { publicSessionToken?: string; policyId?: string } };
  const publicSessionToken = json?.data?.publicSessionToken ?? '';
  const policyId = json?.data?.policyId ?? '';
  if (!publicSessionToken) throw new Error(`createPublicSession(${productCode}): no token returned`);
  return { productCode, publicSessionToken, policyId };
}

/**
 * Customer-journey post-purchase redirect (ABY-238) — the spec needs
 * a deterministic policyId to assert the `/verify-email?email=...&redirect=/client`
 * URL pattern WITHOUT hitting the real OTP send. Test mode emits a
 * fixed OTP code; the fixture returns it for the spec to type into the
 * verify-email screen.
 */
export const FIXED_TEST_OTP = '000000' as const;

export function publicSessionUrl(productCode: ProductCode, token: string, step = 'policy-holder'): string {
  return `/quote/${productCode}/${encodeURIComponent(token)}?step=${encodeURIComponent(step)}`;
}
