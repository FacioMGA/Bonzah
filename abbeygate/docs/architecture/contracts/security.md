---
title: Security decisions contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Security decisions — binding contract

## Governs
The deliberate security posture choices. Each `SD-` is binding; changes require an ADR.

## Posture
| Id | Decision | Source of truth |
|---|---|---|
| SD-001 | CSRF protection via in-memory bearer tokens + strict CORS (no CSRF middleware) | [ADR-0006](../decisions/ADR-0006-csrf-bearer-token-posture.md) |
| SD-002 | CSP enforced in production, report-only in dev (Vite HMR compatibility) | helmet config in `backend/index.ts` |
| SD-003 | `JWT_SECRET` required in EVERY environment. No dev fallback. The startup validator rejects known placeholder values in production. | `backend/index.ts` · `backend/platform/config/startupValidation.ts` |
| SD-004 | Tenant isolation via PostgreSQL RLS (`set_config('app.current_account_id', ...)` per transaction) | [tenancy.md](./tenancy.md) · `backend/http/middleware/rls.ts` |
| SD-005 | Explicit body-size limits on `express.json()` / `urlencoded()`; Multer caps for uploads | `backend/index.ts` (body parser setup) |
| SD-006 | Authenticated frontend bearer-token sessions expire after 30 minutes of inactivity | `frontend/src/modules/auth/useSession.ts` |
| SD-007 | Permission middleware distinguishes `AUTH_REQUIRED`, `PERMISSION_DENIED`, and `PERMISSION_CHECK_FAILED`; all fail closed | `backend/modules/accessControl/http/permissionMiddleware.ts` |
| SD-008 | Public media (images/fonts) served `Cross-Origin-Resource-Policy: cross-origin`; app code/data/API stay `same-origin` | [ADR-0045](../decisions/ADR-0045-public-media-cross-origin-resource-policy.md) · `backend/http/crossOriginAssets.ts` |

## Forbidden
- Storing JWTs in cookies (invalidates SD-001).
- Disabling CSP in production.
- Reading `JWT_SECRET` outside `startupValidation.ts`.
- Bypassing per-request RLS context.
- Removing or relaxing explicit body-size limits.
- Extending inactivity timeout without a security review.
- Treating missing `req.user` as a permission decision.
- Swallowing permission resolver failures as `PERMISSION_DENIED`.
- Reintroducing permission fail-open env flags.

## Escalation
- **Write an ADR** to change any `SD-` entry or add a new one. Never soften a security decision without one.

## Links
- Tenancy model: [tenancy.md](./tenancy.md)
- Validators in CI: `npm run test:tenant-isolation` · `npm run test:webhook-inbound-auth` · `npm run test:auth-transport-policy` · `npm run scan:secrets`
- Enforcing guards: [reference/guards.md](../../reference/guards.md)
