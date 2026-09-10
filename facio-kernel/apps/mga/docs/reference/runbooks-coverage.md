---
title: Runbook Coverage Inventory
audience: agent
status: living
owner: platform-eng
reviewed: 2026-09-09
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

## Runbooks (38)

| Runbook | Owner | Reviewed | Trigger summary | Content revision |
|---------|-------|----------|------------------|--------------|
| `account-intelligence-projection.md` | platform-eng | 2026-08-30 | Use only when live verification proves the read-only Accounts search or intelligence endpoint is missing known policy-ho… | content:03c7f23b804c |
| `agent-triggered-prs.md` | platform-eng | 2026-08-14 | _no Trigger section_ | content:1afe2fbef0c0 |
| `backup-and-restore.md` | platform-eng | 2026-08-03 | _no Trigger section_ | content:78dc82c5ddcb |
| `backup-control-statement.md` | platform-eng | 2026-05-04 | _no Trigger section_ | content:24ff17daae06 |
| `backup-policy.md` | platform-eng | 2026-08-03 | _no Trigger section_ | content:eee53d6beaa0 |
| `bdx-export.md` | platform-eng | 2026-08-14 | _no Trigger section_ | content:ed69d59a47fb |
| `bdx-recovery-rules.md` | platform-eng | 2026-08-09 | _no Trigger section_ | content:fccb55d63ae4 |
| `behavior-vectors.md` | platform-eng | 2026-05-09 | _no Trigger section_ | content:b87a74703e98 |
| `cardcorp-erica-status-2026-07-13.md` | platform-eng | 2026-07-13 | _no Trigger section_ | content:c6c53df030db |
| `cardcorp-live-cutover.md` | platform-eng | 2026-07-06 | _no Trigger section_ | content:9ff2613c5be1 |
| `claim-memory-post-trophy.md` | platform-eng | 2026-05-29 | _no Trigger section_ | content:f52dc892030b |
| `claim-memory.md` | platform-eng | 2026-08-28 | s | Trigger | How it lands | |---|---| | Inbound email on a CLAIM thread | `communicationsService.createMessage` hook → … | content:452fb6aa3edf |
| `creditsafe-live-cutover.md` | platform-eng | 2026-07-30 | _no Trigger section_ | content:7e68f3dc99ac |
| `customer-emails.md` | platform-eng | 2026-09-06 | _no Trigger section_ | content:b21084454c39 |
| `database-migrations.md` | platform-eng | 2026-08-03 | _no Trigger section_ | content:bb9cecce7985 |
| `deploy.md` | platform-eng | 2026-09-04 | _no Trigger section_ | content:794e545c8994 |
| `document-generation-recovery.md` | platform-eng | 2026-08-09 | _no Trigger section_ | content:0d740631c8a0 |
| `document-storage-uri-index.md` | platform-eng | 2026-09-03 | _no Trigger section_ | content:3539e553aa9a |
| `go-live-home-data-cutover.md` | platform-eng | 2026-07-21 | _no Trigger section_ | content:50b7ca665a7d |
| `gr-go-live-checklist.md` | platform-eng | 2026-07-23 | _no Trigger section_ | content:12f667cbc47a |
| `incident-response.md` | platform-eng | 2026-08-03 | _no Trigger section_ | content:9b418a354ad1 |
| `issued-document-recovery.md` | platform-eng | 2026-09-07 | _no Trigger section_ | content:312ebaabc6d4 |
| `manual-renewals.md` | platform-eng | 2026-08-14 | _no Trigger section_ | content:4c779a818740 |
| `manual-underwriting-approval.md` | platform-eng | 2026-09-03 | _no Trigger section_ | content:bcc942183009 |
| `mcp.md` | platform-eng | 2026-08-27 | _no Trigger section_ | content:984d34dc92f7 |
| `monitoring.md` | platform-eng | 2026-05-04 | _no Trigger section_ | content:91cf70fcee51 |
| `new-environment.md` | platform-eng | 2026-08-03 | _no Trigger section_ | content:9525a6dfea5f |
| `policy-cancellation.md` | platform-eng | 2026-08-19 | _no Trigger section_ | content:66ee592fe4ab |
| `pre-deploy-smoke-checklist.md` | platform-eng | 2026-08-30 | _no Trigger section_ | content:923fb2251faa |
| `programme-definition-cutover.md` | platform-eng | 2026-09-06 | _no Trigger section_ | content:acc7af6bd65c |
| `quote-health-canary.md` | platform-eng | 2026-08-10 | _no Trigger section_ | content:cdd8d97d52d3 |
| `rollback.md` | platform-eng | 2026-08-03 | s Tenant isolation test fail · webhook auth regression · p95 > 2× baseline on critical endpoint · error rate > 1% sustai… | content:6c9b13b5903c |
| `secrets-rotation.md` | platform-eng | 2026-05-10 | _no Trigger section_ | content:32221f6a8d14 |
| `segurnet-onboarding.md` | ops | 2026-08-05 | _no Trigger section_ | content:208e535e1941 |
| `sentry-alerts.md` | platform-eng | 2026-08-28 | _no Trigger section_ | content:2b4730d0a697 |
| `spine-cutover.md` | platform-eng | 2026-08-04 | _no Trigger section_ | content:4b5227812a9e |
| `staff-leave-calendar.md` | platform-eng | 2026-08-19 | _no Trigger section_ | content:65834f7e1091 |
| `staging-delivery.md` | platform-eng | 2026-05-04 | _no Trigger section_ | content:bee051084136 |

## Worker handler catalogue (39)

Generated from disk. Every handler file under `backend/workers/handlers/*.ts` appears here automatically. The "Operate runbook reference" column shows whether any operate runbook names the job by string match.

| Worker job | Handler | Operate runbook reference | Content revision |
|------------|---------|---------------------------|--------------|
| `ACCOUNTS360.PROJECTION_BACKFILL` | `backend/workers/handlers/ACCOUNTS360.PROJECTION_BACKFILL.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:ccfeba6fc88c |
| `ACCOUNTS360.PROJECTION_RECONCILE` | `backend/workers/handlers/ACCOUNTS360.PROJECTION_RECONCILE.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:ea061a51edc8 |
| `ACCOUNTS360.PROJECTION_UPDATE` | `backend/workers/handlers/ACCOUNTS360.PROJECTION_UPDATE.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:db45142e8abe |
| `ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL` | `backend/workers/handlers/ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL.ts` | mentioned in `docs/operate/*` | content:1c64fed97978 |
| `ACCOUNT_INTELLIGENCE.PROJECTION_RECONCILE` | `backend/workers/handlers/ACCOUNT_INTELLIGENCE.PROJECTION_RECONCILE.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:f6c561f6fd0b |
| `ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE` | `backend/workers/handlers/ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:cad7819e76c5 |
| `BDX.IMPORT_JOB` | `backend/workers/handlers/BDX.IMPORT_JOB.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:df0b40a72df6 |
| `BEHAVIOR.NORMALIZE` | `backend/workers/handlers/BEHAVIOR.NORMALIZE.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:967d6f735779 |
| `BEHAVIOR.TRAJECTORY_UPDATE` | `backend/workers/handlers/BEHAVIOR.TRAJECTORY_UPDATE.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:2da156d3c89d |
| `CLAIM_MEMORY.REFRESH` | `backend/workers/handlers/CLAIM_MEMORY.REFRESH.ts` | mentioned in `docs/operate/*` | content:8f1a3166c74a |
| `COMM.EMAIL_INGESTED` | `backend/workers/handlers/COMM.EMAIL_INGESTED.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:e0c244004be2 |
| `COMMUNICATION_OUTBOUND` | `backend/workers/handlers/COMMUNICATION_OUTBOUND.ts` | mentioned in `docs/operate/*` | content:b75c2dadfdbb |
| `DOC.DOCX_TO_PDF` | `backend/workers/handlers/DOC.DOCX_TO_PDF.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:560bf856d379 |
| `DOC.GENERATE_BUSINESS_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_BUSINESS_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:065f7a75e7c9 |
| `DOC.GENERATE_COMMERCIAL_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_COMMERCIAL_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:77eb4860d240 |
| `DOC.GENERATE_HEALTH_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_HEALTH_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:8bf7b29c44b1 |
| `DOC.GENERATE_HOME_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_HOME_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:5714a22166e7 |
| `DOC.GENERATE_ISSUED_POLICY_PACK` | `backend/workers/handlers/DOC.GENERATE_ISSUED_POLICY_PACK.ts` | mentioned in `docs/operate/*` | content:4101021ef67a |
| `DOC.GENERATE_MOTOR_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_MOTOR_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:c892308be465 |
| `DOC.GENERATE_OPEN_MARKET_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_OPEN_MARKET_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:d5993e703013 |
| `DOC.GENERATE_QUOTE_PACK` | `backend/workers/handlers/DOC.GENERATE_QUOTE_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:40b9f54f147e |
| `DOC.GENERATE_RENTAL_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_RENTAL_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | unknown |
| `DOC.GENERATE_TRAVEL_DOC_PACK` | `backend/workers/handlers/DOC.GENERATE_TRAVEL_DOC_PACK.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:aa6e2702b9c2 |
| `EMAIL.CANCELLATION_CONFIRMED` | `backend/workers/handlers/EMAIL.CANCELLATION_CONFIRMED.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:c8f3c939dd72 |
| `EMAIL.CANCELLATION_REQUESTED` | `backend/workers/handlers/EMAIL.CANCELLATION_REQUESTED.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:e0ca65117163 |
| `EMAIL.CARDOG_MODEL_SUGGESTION` | `backend/workers/handlers/EMAIL.CARDOG_MODEL_SUGGESTION.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:0bdd91435b63 |
| `EMAIL.EXTERNAL_ISSUANCE_DOCUMENTS_READY` | `backend/workers/handlers/EMAIL.EXTERNAL_ISSUANCE_DOCUMENTS_READY.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:5d0188df797a |
| `EMAIL.INFO_REQUIRED` | `backend/workers/handlers/EMAIL.INFO_REQUIRED.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:a27f7b78c523 |
| `EMAIL.PUBLIC_QUOTE` | `backend/workers/handlers/EMAIL.PUBLIC_QUOTE.ts` | mentioned in `docs/operate/*` | content:e3c2c1a3545f |
| `EMAIL.UW_REFERRAL` | `backend/workers/handlers/EMAIL.UW_REFERRAL.ts` | mentioned in `docs/operate/*` | content:2911548e7d01 |
| `POLICY.INDEX_BACKFILL` | `backend/workers/handlers/POLICY.INDEX_BACKFILL.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:c4faaeb13201 |
| `POLICY.INDEX_RECONCILE` | `backend/workers/handlers/POLICY.INDEX_RECONCILE.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:0c08d063b018 |
| `POLICY.INDEX_UPDATE` | `backend/workers/handlers/POLICY.INDEX_UPDATE.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:f8edec157ef4 |
| `POLICY.ISSUED_PACK_RECONCILE` | `backend/workers/handlers/POLICY.ISSUED_PACK_RECONCILE.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:3f30768af1ec |
| `POLICY.STATE_RECONCILE` | `backend/workers/handlers/POLICY.STATE_RECONCILE.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:baa5e20644f6 |
| `RENEWAL.EMAIL_SCAN` | `backend/workers/handlers/RENEWAL.EMAIL_SCAN.ts` | mentioned in `docs/operate/*` | content:6c6dadfa3cc0 |
| `SUBMISSION_MEMORY.REFRESH` | `backend/workers/handlers/SUBMISSION_MEMORY.REFRESH.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:cc839ec75b45 |
| `XLSX.GENERATE_BORDEREAUX_V52` | `backend/workers/handlers/XLSX.GENERATE_BORDEREAUX_V52.ts` | mentioned in `docs/operate/*` | content:d36dc076edeb |
| `XLSX.PARSE_FIRST_SHEET_TO_JSON` | `backend/workers/handlers/XLSX.PARSE_FIRST_SHEET_TO_JSON.ts` | _no operate doc names this job — generated catalogue is canonical_ | content:d865e30e51db |
