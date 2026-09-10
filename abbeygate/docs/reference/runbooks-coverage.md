---
title: Runbook Coverage Inventory
audience: agent
status: living
owner: platform-eng
reviewed: 2026-09-07
binding: false
generated_by: tools/docs/generate-runbooks-coverage.mjs
---
<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run `npm run docs:generate -- --only=runbooks-coverage` to regenerate.
  CI: `npm run docs:generate -- --check` fails on drift.
-->

# Runbook Coverage Inventory

Every runbook under `docs/operate/` and the canonical worker handler catalogue from `backend/workers/handlers/`. `guard:docs-runbook-coverage` accepts presence in either operate runbooks OR the catalogue below — this generated file is structurally the source.

## Runbooks (34)

| Runbook | Owner | Reviewed | Trigger summary | Last changed |
|---------|-------|----------|------------------|--------------|
| `account-intelligence-projection.md` | platform-eng | 2026-08-30 | Use only when live verification proves the read-only Accounts search or intelligence endpoint is missing known policy-ho… | 2026-08-30 (+0000) |
| `agent-triggered-prs.md` | platform-eng | 2026-08-14 | _no Trigger section_ | 2026-08-18 (+0000) |
| `backup-and-restore.md` | platform-eng | 2026-08-03 | _no Trigger section_ | 2026-08-03 (+0000) |
| `backup-control-statement.md` | platform-eng | 2026-05-04 | _no Trigger section_ | 2026-05-03 (+0000) |
| `backup-policy.md` | platform-eng | 2026-08-03 | _no Trigger section_ | 2026-08-03 (+0000) |
| `bdx-export.md` | platform-eng | 2026-08-14 | _no Trigger section_ | 2026-08-14 (+0000) |
| `bdx-recovery-rules.md` | platform-eng | 2026-08-09 | _no Trigger section_ | 2026-08-09 (+0000) |
| `behavior-vectors.md` | platform-eng | 2026-05-09 | _no Trigger section_ | 2026-05-09 (+0000) |
| `cardcorp-erica-status-2026-07-13.md` | platform-eng | 2026-07-13 | _no Trigger section_ | 2026-07-13 (+0000) |
| `cardcorp-live-cutover.md` | platform-eng | 2026-07-06 | _no Trigger section_ | 2026-08-18 (+0000) |
| `claim-memory-post-trophy.md` | platform-eng | 2026-05-29 | _no Trigger section_ | 2026-05-29 (+0000) |
| `claim-memory.md` | platform-eng | 2026-08-28 | s | Trigger | How it lands | |---|---| | Inbound email on a CLAIM thread | `communicationsService.createMessage` hook → … | 2026-08-28 (+0000) |
| `creditsafe-live-cutover.md` | platform-eng | 2026-07-30 | _no Trigger section_ | 2026-08-06 (+0000) |
| `customer-emails.md` | platform-eng | 2026-09-02 | _no Trigger section_ | 2026-09-03 (+0000) |
| `database-migrations.md` | platform-eng | 2026-08-03 | _no Trigger section_ | 2026-08-03 (+0000) |
| `deploy.md` | platform-eng | 2026-08-03 | _no Trigger section_ | 2026-08-03 (+0000) |
| `document-generation-recovery.md` | platform-eng | 2026-08-09 | _no Trigger section_ | 2026-08-19 (+0000) |
| `go-live-home-data-cutover.md` | platform-eng | 2026-07-21 | _no Trigger section_ | 2026-07-21 (+0000) |
| `gr-go-live-checklist.md` | platform-eng | 2026-07-23 | _no Trigger section_ | 2026-07-23 (+0000) |
| `incident-response.md` | platform-eng | 2026-08-03 | _no Trigger section_ | 2026-08-18 (+0000) |
| `manual-renewals.md` | platform-eng | 2026-08-14 | _no Trigger section_ | 2026-08-28 (+0000) |
| `mcp.md` | platform-eng | 2026-08-27 | _no Trigger section_ | 2026-08-27 (+0000) |
| `monitoring.md` | platform-eng | 2026-05-04 | _no Trigger section_ | 2026-08-28 (+0000) |
| `new-environment.md` | platform-eng | 2026-08-03 | _no Trigger section_ | 2026-08-03 (+0000) |
| `policy-cancellation.md` | platform-eng | 2026-08-19 | _no Trigger section_ | 2026-08-28 (+0000) |
| `pre-deploy-smoke-checklist.md` | platform-eng | 2026-08-30 | _no Trigger section_ | 2026-08-30 (+0000) |
| `quote-health-canary.md` | platform-eng | 2026-08-10 | _no Trigger section_ | 2026-08-10 (+0000) |
| `rollback.md` | platform-eng | 2026-08-03 | s Tenant isolation test fail · webhook auth regression · p95 > 2× baseline on critical endpoint · error rate > 1% sustai… | 2026-08-03 (+0000) |
| `secrets-rotation.md` | platform-eng | 2026-05-10 | _no Trigger section_ | 2026-05-10 (+0000) |
| `segurnet-onboarding.md` | ops | 2026-08-05 | _no Trigger section_ | 2026-08-05 (+0000) |
| `sentry-alerts.md` | platform-eng | 2026-08-28 | _no Trigger section_ | 2026-08-28 (+0000) |
| `spine-cutover.md` | platform-eng | 2026-08-04 | _no Trigger section_ | 2026-08-04 (+0000) |
| `staff-leave-calendar.md` | platform-eng | 2026-08-19 | _no Trigger section_ | 2026-08-19 (+0000) |
| `staging-delivery.md` | platform-eng | 2026-05-04 | _no Trigger section_ | 2026-07-06 (+0000) |

## Worker handler catalogue (36)

Generated from disk. Every handler file under `backend/workers/handlers/*.ts` appears here automatically. The "Operate runbook reference" column shows whether any operate runbook names the job by string match.

| Worker job | Handler | Operate runbook reference | Last changed |
|------------|---------|---------------------------|--------------|
| `ACCOUNTS360.PROJECTION_BACKFILL` | `backend/workers/handlers/ACCOUNTS360.PROJECTION_BACKFILL.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-25 (+0000) |
| `ACCOUNTS360.PROJECTION_RECONCILE` | `backend/workers/handlers/ACCOUNTS360.PROJECTION_RECONCILE.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-25 (+0000) |
| `ACCOUNTS360.PROJECTION_UPDATE` | `backend/workers/handlers/ACCOUNTS360.PROJECTION_UPDATE.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-08-18 (+0000) |
| `ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL` | `backend/workers/handlers/ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL.ts` | mentioned in `docs/operate/*` | 2026-05-25 (+0000) |
| `ACCOUNT_INTELLIGENCE.PROJECTION_RECONCILE` | `backend/workers/handlers/ACCOUNT_INTELLIGENCE.PROJECTION_RECONCILE.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-25 (+0000) |
| `ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE` | `backend/workers/handlers/ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-08-18 (+0000) |
| `BDX.IMPORT_JOB` | `backend/workers/handlers/BDX.IMPORT_JOB.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-20 (+0000) |
| `BEHAVIOR.NORMALIZE` | `backend/workers/handlers/BEHAVIOR.NORMALIZE.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-08-18 (+0000) |
| `BEHAVIOR.TRAJECTORY_UPDATE` | `backend/workers/handlers/BEHAVIOR.TRAJECTORY_UPDATE.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-08-28 (+0000) |
| `CLAIM_MEMORY.REFRESH` | `backend/workers/handlers/CLAIM_MEMORY.REFRESH.ts` | mentioned in `docs/operate/*` | 2026-05-29 (+0000) |
| `COMM.EMAIL_INGESTED` | `backend/workers/handlers/COMM.EMAIL_INGESTED.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-06-12 (+0000) |
| `COMMUNICATION_OUTBOUND` | `backend/workers/handlers/COMMUNICATION_OUTBOUND.ts` | mentioned in `docs/operate/*` | 2026-08-11 (+0000) |
| `DOC.DOCX_TO_PDF` | `backend/workers/handlers/DOC.DOCX_TO_PDF.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-20 (+0000) |
| `DOC.GENERATE_BUSINESS_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_BUSINESS_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-08-18 (+0000) |
| `DOC.GENERATE_HEALTH_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_HEALTH_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-08-18 (+0000) |
| `DOC.GENERATE_HOME_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_HOME_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-08-18 (+0000) |
| `DOC.GENERATE_ISSUED_POLICY_PACK` | `backend/workers/handlers/DOC.GENERATE_ISSUED_POLICY_PACK.ts` | mentioned in `docs/operate/*` | 2026-08-28 (+0000) |
| `DOC.GENERATE_MOTOR_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_MOTOR_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-08-18 (+0000) |
| `DOC.GENERATE_OPEN_MARKET_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_OPEN_MARKET_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-08-18 (+0000) |
| `DOC.GENERATE_QUOTE_PACK` | `backend/workers/handlers/DOC.GENERATE_QUOTE_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-20 (+0000) |
| `DOC.GENERATE_TRAVEL_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_TRAVEL_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-08-18 (+0000) |
| `EMAIL.CANCELLATION_CONFIRMED` | `backend/workers/handlers/EMAIL.CANCELLATION_CONFIRMED.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-20 (+0000) |
| `EMAIL.CANCELLATION_REQUESTED` | `backend/workers/handlers/EMAIL.CANCELLATION_REQUESTED.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-20 (+0000) |
| `EMAIL.CARDOG_MODEL_SUGGESTION` | `backend/workers/handlers/EMAIL.CARDOG_MODEL_SUGGESTION.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-06-02 (+0000) |
| `EMAIL.INFO_REQUIRED` | `backend/workers/handlers/EMAIL.INFO_REQUIRED.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-20 (+0000) |
| `EMAIL.PUBLIC_QUOTE` | `backend/workers/handlers/EMAIL.PUBLIC_QUOTE.ts` | mentioned in `docs/operate/*` | 2026-08-28 (+0000) |
| `EMAIL.UW_REFERRAL` | `backend/workers/handlers/EMAIL.UW_REFERRAL.ts` | mentioned in `docs/operate/*` | 2026-08-25 (+0000) |
| `POLICY.INDEX_BACKFILL` | `backend/workers/handlers/POLICY.INDEX_BACKFILL.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-25 (+0000) |
| `POLICY.INDEX_RECONCILE` | `backend/workers/handlers/POLICY.INDEX_RECONCILE.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-25 (+0000) |
| `POLICY.INDEX_UPDATE` | `backend/workers/handlers/POLICY.INDEX_UPDATE.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-07-18 (+0000) |
| `POLICY.ISSUED_PACK_RECONCILE` | `backend/workers/handlers/POLICY.ISSUED_PACK_RECONCILE.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-09-02 (+0000) |
| `POLICY.STATE_RECONCILE` | `backend/workers/handlers/POLICY.STATE_RECONCILE.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-25 (+0000) |
| `RENEWAL.EMAIL_SCAN` | `backend/workers/handlers/RENEWAL.EMAIL_SCAN.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-08-27 (+0000) |
| `SUBMISSION_MEMORY.REFRESH` | `backend/workers/handlers/SUBMISSION_MEMORY.REFRESH.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-06-12 (+0000) |
| `XLSX.GENERATE_BORDEREAUX_V52` | `backend/workers/handlers/XLSX.GENERATE_BORDEREAUX_V52.ts` | mentioned in `docs/operate/*` | 2026-05-20 (+0000) |
| `XLSX.PARSE_FIRST_SHEET_TO_JSON` | `backend/workers/handlers/XLSX.PARSE_FIRST_SHEET_TO_JSON.ts` | _no operate doc names this job — generated catalogue is canonical_ | 2026-05-20 (+0000) |
