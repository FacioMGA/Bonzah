---
title: Behavior vectors runbook
audience: operator
status: living
owner: platform-eng
reviewed: 2026-05-09
binding: false
---

# Behavior vectors

## Scope
Operational checks for pgvector-backed behavior intelligence: `behavior_events.embedding` and `policy_trajectories.trajectoryEmbedding`.

## Startup
- Production must set `OPENAI_API_KEY` when behavior fan-out is enabled.
- `ALLOW_STUB_EMBEDDINGS_IN_PRODUCTION=true` is an explicit degraded-mode exception only.
- `DB_INDEX_BOOTSTRAP=strict` is recommended before declaring a new environment ready.

## Backfill / replay
Dry-run first:
`npx tsx backend/scripts/replayBehaviorFromOutbox.mts --tenant <slug> --dry-run`

Replay:
`npx tsx backend/scripts/replayBehaviorFromOutbox.mts --tenant <slug> --batch-size 200`

The final summary must show `missingEventEmbeddings=0` and `missingTrajectoryEmbeddings=0` for the target tenant, unless a known partial replay is in progress.

## Index verification
Run:
`npx tsx backend/scripts/explainBehaviorSimilarity.mts --tenant-id <tenantId> --policy-id <policyId>`

Accept only plans that use `policy_trajectories_embedding_hnsw_cosine_idx`, or record why the exact-scan plan is acceptable for the current row count.

## Failure-zone monitoring
BO can call `GET /api/behavior/policies/:id/failure-zone` to combine deterministic issuance gaps with similar historical failure trajectories.

Treat `severity=alert` as an ops follow-up cue, not an issuance decision. Canonical readiness and lifecycle contracts remain authoritative.

## Recovery
- Re-run replay safely; `BehaviorEvent.sourceEventId` is unique and duplicates update trajectories.
- If vector index bootstrap fails, run with `DB_INDEX_BOOTSTRAP=strict` in a maintenance window and inspect the failed DDL log.
- If dormant vector cleanup migration refuses to drop data, stop and decide a canonical owner before retrying.
