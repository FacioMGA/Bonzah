---
title: API Changelog
audience: developer
status: living
owner: platform-eng
reviewed: 2026-05-03
binding: false
---

# API Changelog

All notable changes to the Abbeygate API are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `backend/modules/ledger/` stub module (ADR-0005)
- `backend/modules/users/http/usersRouter.ts` — users module HTTP layer (extracted from route file)
- `backend/platform/types/errors.ts` — typed error hierarchy (`AppError`, `ValidationError`, `NotFoundError`, etc.)
- `backend/platform/redis/cache.ts` — Redis read-through cache utility
- `backend/http/middleware/cacheControl.ts` — HTTP cache-control middleware
- Pre-bind/pre-issue sanctions screening gate using Creditsafe with persisted `sanction_screening_runs` and `compliance_decisions` audit evidence.

### Changed
- Startup validation now rejects `JWT_SECRET` dev default in production
- Helmet CSP enabled in report-only mode for development
- Added `Strict-Transport-Security`, `Permissions-Policy` headers
- Prisma connection pool explicitly configured via `PRISMA_CONNECTION_LIMIT` and `PRISMA_POOL_TIMEOUT`
- Non-HTTP bootstraps parallelized for faster startup
- Worker concurrency configurable via `WORKER_CONCURRENCY` env var
- BDX export flow collapsed to a single Lloyd's V5.2 path (`preview` + `export`), removing superseded run-generator branches and export aliases.
- Premium BDX semantic contract finalized:
  - CR-first premium mapping (`CR0021`, `CR0029`, `CR0288`, `CR0289`, `CR1297`)
  - `CR0056` uses financial movement labels (`Original Premium`, `Additional Premium`, `Return Premium`)
  - `CR0064` (stamp duty tax) and `CR0925` (MIF fee) are explicitly separated
  - `CR0065 = CR0059 - CR0062` in current model
  - fixed tax detail uses `CR0081`; `CR0080` is blank-by-design for fixed stamp duty
- Added row-level preview issue workflow (valid/warning/error) with export blocking on errors and warning visibility.
- Final export defaults to excluding zero-financial premium rows, with explicit include override and audit logging.
- Bind/issue paths now fail closed on sanctions provider unavailability after one transient retry and hard-block on any sanctions hit.

### Security
- Eliminated all `innerHTML` usages in frontend (CardCorpAdapter, AddressAutocomplete, Step5Payment)
- Added Dependabot configuration for automated dependency updates
- Documented CSRF posture decision (ADR-0006)

## [1.0.5] — 2026-03-09

Initial documented version. Prior changes were not tracked in this changelog.
