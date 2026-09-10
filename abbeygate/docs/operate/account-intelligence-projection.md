---
title: Account intelligence projection recovery
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-30
binding: true
---

# Account intelligence projection recovery

## When to use
Use only when live verification proves the read-only Accounts search or intelligence endpoint is missing known policy-holder data. Do not edit projection rows or shell into AKS.

## Recovery path
1. Merge the reviewed recovery change and wait for CI, images, and the normal staging deploy.
2. Dispatch **AKS Deploy (Staging)** for the exact immutable SHA with a unique lowercase `account_intelligence_backfill_run_id` and the exact affected tenant slug; wait for its Job to complete and verify a known staging account search.
3. Dispatch **AKS Deploy** for the same staging-verified SHA, a new production run id, and the same tenant slug. The Helm post-upgrade Job uses the worker image, explicit tenant ALS, and `ACCOUNT_INTELLIGENCE.PROJECTION_BACKFILL` canonical implementation.
4. Read the completed Job logs for `processed`, verify `/health`, then verify the same known live Accounts search. Retain the Job as deployment evidence.

## Guardrails
- Default Helm values never run this Job; only the workflow input renders it.
- A failure is terminal: inspect the Job logs and the `queue.system_outbox.enqueue_failed` log before retrying with a new run id.
- It rebuilds projections only; it must not bind, email, pay, allocate, or modify customer source records.
