---
title: Worker Handlers Inventory
audience: agent
status: living
owner: platform-eng
reviewed: 2026-09-09
binding: false
generated_by: tools/docs/generate-workers.mjs
---
<!--
  GENERATED FILE — DO NOT EDIT BY HAND.
  Run `npm run docs:generate -- --only=workers` to regenerate.
  CI: `npm run docs:generate -- --check` fails on drift.
-->

# Worker Handlers Inventory

Canonical list of every BullMQ worker handler under `backend/workers/handlers/`. Concurrency is governed by `WORKER_CONCURRENCY` (env) or per-handler overrides in `registerQueues.ts`. Retry/backoff is set at queue registration time.

## Schema

| Column | Source |
|--------|--------|
| Handler | File name under `backend/workers/handlers/` |
| Handler id | Filename without `.ts` |
| Job name | `registerHandler('<JOB>', ...)` key inside the handler file |
| Queue | Queue name resolved from the eventType prefix rules in `backend/platform/events/queue.ts` (`routeEventToQueue`) |
| Content revision | Stable hash of the handler content |

## Inventory (39 handlers)

| Handler | Handler id | Job name | Queue | Content revision |
|---------|------------|----------|-------|--------------|
| `ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL.ts` | `ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL` | `ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL` | `data-sync` | content:1c64fed97978 |
| `ACCOUNT_INTELLIGENCE.PROJECTION_RECONCILE.ts` | `ACCOUNT_INTELLIGENCE.PROJECTION_RECONCILE` | `ACCOUNT_INTELLIGENCE.PROJECTION_RECONCILE` | `data-sync` | content:f6c561f6fd0b |
| `ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE.ts` | `ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE` | `ACCOUNT_INTELLIGENCE.PROJECTION_UPDATE` | `data-sync` | content:cad7819e76c5 |
| `ACCOUNTS360.PROJECTION_BACKFILL.ts` | `ACCOUNTS360.PROJECTION_BACKFILL` | `ACCOUNTS360.PROJECTION_BACKFILL` | `data-sync` | content:ccfeba6fc88c |
| `ACCOUNTS360.PROJECTION_RECONCILE.ts` | `ACCOUNTS360.PROJECTION_RECONCILE` | `ACCOUNTS360.PROJECTION_RECONCILE` | `data-sync` | content:ea061a51edc8 |
| `ACCOUNTS360.PROJECTION_UPDATE.ts` | `ACCOUNTS360.PROJECTION_UPDATE` | `ACCOUNTS360.PROJECTION_UPDATE` | `data-sync` | content:db45142e8abe |
| `BDX.IMPORT_JOB.ts` | `BDX.IMPORT_JOB` | `BDX.IMPORT_JOB` | `data-sync` | content:df0b40a72df6 |
| `BEHAVIOR.NORMALIZE.ts` | `BEHAVIOR.NORMALIZE` | `BEHAVIOR.NORMALIZE` | `data-sync` | content:967d6f735779 |
| `BEHAVIOR.TRAJECTORY_UPDATE.ts` | `BEHAVIOR.TRAJECTORY_UPDATE` | `BEHAVIOR.TRAJECTORY_UPDATE` | `data-sync` | content:2da156d3c89d |
| `CLAIM_MEMORY.REFRESH.ts` | `CLAIM_MEMORY.REFRESH` | `CLAIM_MEMORY.REFRESH` | `data-sync` | content:8f1a3166c74a |
| `COMM.EMAIL_INGESTED.ts` | `COMM.EMAIL_INGESTED` | `COMM.EMAIL_INGESTED` | `data-sync` | content:e0c244004be2 |
| `COMMUNICATION_OUTBOUND.ts` | `COMMUNICATION_OUTBOUND` | `COMM.OUTBOUND_QUEUED` | `notifications` | content:b75c2dadfdbb |
| `DOC.DOCX_TO_PDF.ts` | `DOC.DOCX_TO_PDF` | `DOC.DOCX_TO_PDF` | `documents` | content:560bf856d379 |
| `DOC.GENERATE_BUSINESS_DOC_PACK.ts` | `DOC.GENERATE_BUSINESS_DOC_PACK` | `DOC.GENERATE_BUSINESS_DOC_PACK` | `documents` | content:065f7a75e7c9 |
| `DOC.GENERATE_COMMERCIAL_DOC_PACK.ts` | `DOC.GENERATE_COMMERCIAL_DOC_PACK` | `DOC.GENERATE_COMMERCIAL_DOC_PACK` | `documents` | content:77eb4860d240 |
| `DOC.GENERATE_HEALTH_DOC_PACK.ts` | `DOC.GENERATE_HEALTH_DOC_PACK` | `DOC.GENERATE_HEALTH_DOC_PACK` | `documents` | content:8bf7b29c44b1 |
| `DOC.GENERATE_HOME_DOC_PACK.ts` | `DOC.GENERATE_HOME_DOC_PACK` | `DOC.GENERATE_HOME_DOC_PACK` | `documents` | content:5714a22166e7 |
| `DOC.GENERATE_ISSUED_POLICY_PACK.ts` | `DOC.GENERATE_ISSUED_POLICY_PACK` | `DOC.GENERATE_ISSUED_POLICY_PACK` | `documents` | content:4101021ef67a |
| `DOC.GENERATE_MOTOR_DOC_PACK.ts` | `DOC.GENERATE_MOTOR_DOC_PACK` | `DOC.GENERATE_MOTOR_DOC_PACK` | `documents` | content:c892308be465 |
| `DOC.GENERATE_OPEN_MARKET_DOC_PACK.ts` | `DOC.GENERATE_OPEN_MARKET_DOC_PACK` | `DOC.GENERATE_OPEN_MARKET_DOC_PACK` | `documents` | content:d5993e703013 |
| `DOC.GENERATE_QUOTE_PACK.ts` | `DOC.GENERATE_QUOTE_PACK` | `DOC.GENERATE_QUOTE_PACK` | `documents` | content:40b9f54f147e |
| `DOC.GENERATE_RENTAL_DOC_PACK.ts` | `DOC.GENERATE_RENTAL_DOC_PACK` | `DOC.GENERATE_RENTAL_DOC_PACK` | `documents` | unknown |
| `DOC.GENERATE_TRAVEL_DOC_PACK.ts` | `DOC.GENERATE_TRAVEL_DOC_PACK` | `DOC.GENERATE_TRAVEL_DOC_PACK` | `documents` | content:aa6e2702b9c2 |
| `EMAIL.CANCELLATION_CONFIRMED.ts` | `EMAIL.CANCELLATION_CONFIRMED` | `EMAIL.CANCELLATION_CONFIRMED` | `notifications` | content:c8f3c939dd72 |
| `EMAIL.CANCELLATION_REQUESTED.ts` | `EMAIL.CANCELLATION_REQUESTED` | `EMAIL.CANCELLATION_REQUESTED` | `notifications` | content:e0ca65117163 |
| `EMAIL.CARDOG_MODEL_SUGGESTION.ts` | `EMAIL.CARDOG_MODEL_SUGGESTION` | `EMAIL.CARDOG_MODEL_SUGGESTION` | `notifications` | content:0bdd91435b63 |
| `EMAIL.EXTERNAL_ISSUANCE_DOCUMENTS_READY.ts` | `EMAIL.EXTERNAL_ISSUANCE_DOCUMENTS_READY` | `EMAIL.EXTERNAL_ISSUANCE_DOCUMENTS_READY` | `notifications` | content:5d0188df797a |
| `EMAIL.INFO_REQUIRED.ts` | `EMAIL.INFO_REQUIRED` | `EMAIL.INFO_REQUIRED` | `notifications` | content:a27f7b78c523 |
| `EMAIL.PUBLIC_QUOTE.ts` | `EMAIL.PUBLIC_QUOTE` | `EMAIL.PUBLIC_QUOTE` | `notifications` | content:e3c2c1a3545f |
| `EMAIL.UW_REFERRAL.ts` | `EMAIL.UW_REFERRAL` | `EMAIL.UW_REFERRAL` | `notifications` | content:2911548e7d01 |
| `POLICY.INDEX_BACKFILL.ts` | `POLICY.INDEX_BACKFILL` | `POLICY.INDEX_BACKFILL` | `data-sync` | content:c4faaeb13201 |
| `POLICY.INDEX_RECONCILE.ts` | `POLICY.INDEX_RECONCILE` | `POLICY.INDEX_RECONCILE` | `data-sync` | content:0c08d063b018 |
| `POLICY.INDEX_UPDATE.ts` | `POLICY.INDEX_UPDATE` | `POLICY.INDEX_UPDATE` | `data-sync` | content:f8edec157ef4 |
| `POLICY.ISSUED_PACK_RECONCILE.ts` | `POLICY.ISSUED_PACK_RECONCILE` | `POLICY.ISSUED_PACK_RECONCILE` | `data-sync` | content:3f30768af1ec |
| `POLICY.STATE_RECONCILE.ts` | `POLICY.STATE_RECONCILE` | `POLICY.STATE_RECONCILE` | `data-sync` | content:baa5e20644f6 |
| `RENEWAL.EMAIL_SCAN.ts` | `RENEWAL.EMAIL_SCAN` | `RENEWAL.EMAIL_SCAN` | `notifications` | content:6c6dadfa3cc0 |
| `SUBMISSION_MEMORY.REFRESH.ts` | `SUBMISSION_MEMORY.REFRESH` | `SUBMISSION_MEMORY.REFRESH` | `data-sync` | content:cc839ec75b45 |
| `XLSX.GENERATE_BORDEREAUX_V52.ts` | `XLSX.GENERATE_BORDEREAUX_V52` | `XLSX.GENERATE_BORDEREAUX_V52` | `documents` | content:d36dc076edeb |
| `XLSX.PARSE_FIRST_SHEET_TO_JSON.ts` | `XLSX.PARSE_FIRST_SHEET_TO_JSON` | `XLSX.PARSE_FIRST_SHEET_TO_JSON` | `documents` | content:d865e30e51db |
