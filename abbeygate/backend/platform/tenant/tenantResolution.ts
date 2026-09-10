import type { Request } from 'express';

export type TenantResolutionMode = 'public' | 'authenticated';

export class TenantResolutionError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function readHeaderTenant(req: Request): string {
  return String(req.headers['x-tenant-id'] || '').trim();
}

function readAuthTenant(req: Request): string {
  const user = req.user;
  const apiAccount = req.apiAccount;
  return String(
    user?.accountId ||
      user?.primaryAccountId ||
      apiAccount?.id ||
      '',
  ).trim();
}

export function resolveTenantOrThrow(req: Request, mode: TenantResolutionMode): string {
  const headerTenant = readHeaderTenant(req);
  const authTenant = readAuthTenant(req);

  if (mode === 'public') {
    if (!headerTenant) {
      throw new TenantResolutionError(400, 'TENANT_REQUIRED', 'Missing x-tenant-id for public tenant-scoped write path');
    }
    return headerTenant;
  }

  if (!authTenant) {
    throw new TenantResolutionError(401, 'UNAUTHORIZED', 'Authenticated tenant context is missing');
  }
  if (headerTenant && headerTenant !== authTenant) {
    throw new TenantResolutionError(403, 'TENANT_MISMATCH', 'x-tenant-id does not match authenticated tenant context');
  }
  return authTenant;
}
