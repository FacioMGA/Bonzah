import { isIP } from 'node:net';
import type { Request } from 'express';

// Public developer API contract, mirrored in backend/platform/openapi/openapi.ts.
export const PUBLIC_API_RATE_LIMIT_MAX_DEFAULT = 1000;

export function normalizeIpForRateLimit(raw: string): string {
  let v = raw.trim();

  if (v.startsWith('::ffff:')) v = v.slice('::ffff:'.length);

  const zoneIdx = v.indexOf('%');
  if (zoneIdx !== -1) v = v.slice(0, zoneIdx);

  const bracketMatch = v.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketMatch) v = bracketMatch[1];

  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.replace(/:\d+$/, '');

  return v;
}

export function getClientIpForRateLimit(req: Request): string {
  const xff =
    typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
      : undefined;

  const candidates = [
    Array.isArray(req.ips) && req.ips.length > 0 ? req.ips[0] : undefined,
    req.ip,
    xff,
    req.socket?.remoteAddress,
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    const normalized = normalizeIpForRateLimit(c);
    if (isIP(normalized)) return normalized;
  }

  return 'unknown';
}

export function readRateLimitInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export function resolvePublicApiIdentityKey(req: Request): string {
  const apiKey = String(req.headers['x-api-key'] || '').trim();
  const tenantId = String(req.headers['x-tenant-id'] || '').trim();
  if (apiKey) {
    return tenantId ? `apikey:${apiKey}:tenant:${tenantId}` : `apikey:${apiKey}`;
  }
  if (tenantId) {
    return `tenant:${tenantId}:ip:${getClientIpForRateLimit(req)}`;
  }
  return `ip:${getClientIpForRateLimit(req)}`;
}

export function resolveReadinessLimiterKey(req: Request): string {
  const tenantId = String(req.headers['x-tenant-id'] || '').trim() || 'no-tenant';
  const policyId = String(req.params?.policyId || '').trim() || 'no-policy';
  const sessionId =
    String(req.headers['x-session-id'] || '').trim() ||
    String(req.headers['x-public-session-token'] || '').trim() ||
    String(req.query?.sessionId || '').trim();
  const ip = getClientIpForRateLimit(req);
  return `${tenantId}:${policyId}:${sessionId || ip}`;
}

export function isPublicQuoteSessionRequest(req: Request): boolean {
  const url = String(req.originalUrl || req.url || '');
  return /^\/api\/public\/[^/?#]+\/session(?:[/?#]|$)/.test(url);
}

export function resolvePublicQuoteSessionLimiterKey(req: Request): string {
  const url = String(req.originalUrl || req.url || '');
  const match = url.match(/^\/api\/public\/([^/?#]+)\/session(?:\/([^/?#]+))?/);
  const product = String(match?.[1] || 'unknown').trim();
  const token =
    String(match?.[2] || '').trim() ||
    String(req.params?.token || req.params?.policyId || '').trim() ||
    String(req.headers['x-public-session-token'] || '').trim();
  return `quote-session:${product}:${token || getClientIpForRateLimit(req)}`;
}

