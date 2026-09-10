import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import {
  getClientIpForRateLimit,
  isPublicQuoteSessionRequest,
  normalizeIpForRateLimit,
  PUBLIC_API_RATE_LIMIT_MAX_DEFAULT,
  resolvePublicApiIdentityKey,
  resolvePublicQuoteSessionLimiterKey,
  resolveReadinessLimiterKey,
} from '../rateLimit.js';

function makeReq(parts: Partial<Request>): Request {
  return parts as Request;
}

describe('rateLimit helpers', () => {
  it('normalizes ipv4-mapped and port suffixed addresses', () => {
    expect(normalizeIpForRateLimit('::ffff:109.186.70.57')).toBe('109.186.70.57');
    expect(normalizeIpForRateLimit('109.186.70.57:63111')).toBe('109.186.70.57');
  });

  it('keeps the public API default aligned with the developer portal contract', () => {
    expect(PUBLIC_API_RATE_LIMIT_MAX_DEFAULT).toBe(1000);
  });

  it('keys api v1 by api key and tenant when present', () => {
    const headers: Request['headers'] = { 'x-api-key': 'abc123', 'x-tenant-id': 'tenant-1' };
    const req = makeReq({ headers, ip: '10.0.0.1' });
    expect(resolvePublicApiIdentityKey(req)).toBe('apikey:abc123:tenant:tenant-1');
  });

  it('keys api v1 by api key when no tenant override is present', () => {
    const headers: Request['headers'] = { 'x-api-key': 'abc123' };
    const req = makeReq({ headers, ip: '10.0.0.1' });
    expect(resolvePublicApiIdentityKey(req)).toBe('apikey:abc123');
  });

  it('keys api v1 by tenant and ip when pre-auth requests include only tenant context', () => {
    const headers: Request['headers'] = { 'x-tenant-id': 'tenant-1' };
    const req = makeReq({ headers, ip: '10.0.0.1' });
    expect(resolvePublicApiIdentityKey(req)).toBe('tenant:tenant-1:ip:10.0.0.1');
  });

  it('builds readiness key from tenant policy and session', () => {
    const headers: Request['headers'] = { 'x-tenant-id': 'tenant-1', 'x-session-id': 'sess-1' };
    const req = makeReq({
      headers,
      params: { policyId: 'policy-1' },
      query: {},
      ip: '10.0.0.1',
    });
    expect(resolveReadinessLimiterKey(req)).toBe('tenant-1:policy-1:sess-1');
  });

  it('falls back to normalized ip when no session token exists', () => {
    const headers: Request['headers'] = { 'x-tenant-id': 'tenant-1' };
    const req = makeReq({
      headers,
      params: { policyId: 'policy-1' },
      query: {},
      ip: '::ffff:10.9.8.7',
      ips: [],
    });
    expect(getClientIpForRateLimit(req)).toBe('10.9.8.7');
    expect(resolveReadinessLimiterKey(req)).toBe('tenant-1:policy-1:10.9.8.7');
  });

  it('classifies public quote-session endpoints for the dedicated limiter', () => {
    const req = makeReq({
      originalUrl: '/api/public/motor/session/public-token-1',
      params: {},
      headers: {},
      ip: '10.0.0.1',
    });
    expect(isPublicQuoteSessionRequest(req)).toBe(true);
    expect(resolvePublicQuoteSessionLimiterKey(req)).toBe('quote-session:motor:public-token-1');
  });

  it('does not classify other public endpoints as quote-session traffic', () => {
    const req = makeReq({
      originalUrl: '/api/public/documents/doc-1',
      params: {},
      headers: {},
      ip: '10.0.0.1',
    });
    expect(isPublicQuoteSessionRequest(req)).toBe(false);
  });
});

