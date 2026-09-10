import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { resolveTenantOrThrow, TenantResolutionError } from '../tenantResolution.js';

function reqWith(headers: Record<string, string>, extras: Record<string, unknown> = {}): Request {
  const req: Request = {
    headers,
    ...extras,
  };
  return req;
}

describe('tenantResolution', () => {
  it('requires x-tenant-id for public mode', () => {
    const req = reqWith({});
    expect(() => resolveTenantOrThrow(req, 'public')).toThrow(TenantResolutionError);
  });

  it('returns x-tenant-id for public mode', () => {
    const req = reqWith({ 'x-tenant-id': 'tenant-a' });
    expect(resolveTenantOrThrow(req, 'public')).toBe('tenant-a');
  });

  it('uses authenticated tenant and rejects mismatch headers', () => {
    const authReq = reqWith({ 'x-tenant-id': 'tenant-a' }, { user: { primaryAccountId: 'tenant-a' } });
    expect(resolveTenantOrThrow(authReq, 'authenticated')).toBe('tenant-a');

    const mismatch = reqWith({ 'x-tenant-id': 'tenant-b' }, { user: { primaryAccountId: 'tenant-a' } });
    expect(() => resolveTenantOrThrow(mismatch, 'authenticated')).toThrow(TenantResolutionError);
  });
});

