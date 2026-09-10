import 'express';
import type { ApiAccount } from '../../http/middleware/apiKeyAuth.js';

// Canonical Express Request augmentation surface.
//
// One file owns every cross-cutting property attached to `req` by middleware.
// Modules MAY extend Request with module-specific properties next to the
// middleware that writes them (e.g. `permissionMiddleware.ts` adds
// `resolvedPermissions`), but they MUST NOT redeclare any property listed
// here, and they MUST NOT recreate one of the cross-cutting concepts
// (auth user, correlation id, audit context, surface, tenant scope,
// API account) under a different name.
//
// Enforced by `tools/quality/check-express-request-augmentation-single-source.mjs`
// against `tools/quality/express-request-augmentation-allowlist.json`.

declare global {
  namespace Express {
    interface UserTokenPayload {
      id: string;
      role?: string;
      tokenVersion?: number;
      isActive?: boolean;
      [key: string]: unknown;
    }

    /**
     * Per-request audit envelope set by the audit middlewares.
     * Identical shape across `audit.ts`, `paymentsAuditMiddleware.ts`,
     * `claimsAuditMiddleware.ts`, and `quotePublicMiddleware.ts` — owned here
     * so those middlewares cannot drift from each other.
     */
    interface AuditContext {
      correlationId?: string;
      actionId?: string;
      tenantId?: string;
      actorId?: string;
      actorType?: string;
    }

    interface Request {
      user?: UserTokenPayload;
      correlationId?: string;
      apiSurface?: 'public' | 'client' | 'bo';
      tenantId?: string;
      apiAccount?: ApiAccount;
      auditContext?: AuditContext;
    }
  }
}

export {};
