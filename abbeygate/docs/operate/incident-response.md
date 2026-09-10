---
title: Incident response
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Incident response — 2 a.m. triage tree

## Declare
`INCIDENT [severity] [one-line symptom]` on on-call channel. Assign IC + rollback owner (can be same person). Targets: rollback RTO < 10 min · data RTO ≤ 4 h.

## Classify (≤ 60 s, stop at first match)
| Symptom | Branch |
|---|---|
| Service down (no `/health`, edge 5xx) | A — Service down |
| Up but slow / wrong responses | B — Degraded |
| Background work stalled (queue depth, missing emails / docs) | C — Workers stalled |
| Data correctness suspected (wrong policy/claim state, RLS leak) | D — Data integrity |
| Security event (auth bypass, secret leak, intrusion) | E — Security |

## A · Service down
1. Confirm `/health` on the chart-authoritative hosts (`abbeygate-{cy,pt,gr,es}.facio.io`, `{cy,pt,gr}.abbeygate.com` — see Helm `values.yaml`, ADR-0049). 2. AppGw backend health. 3. Recent deploy → [rollback.md](./rollback.md). 4. Else: AKS pod status / events; Postgres availability (refused vs auth fail vs timeout); Redis availability. 5. Data layer suspect → Branch D. 6. Capture evidence (`npm run evidence:staging` shape; for prod, AKS workflow artifacts).

## B · Degraded
1. Run canonical log queries ([monitoring.md](./monitoring.md)). 2. p95 > 2× baseline ≥ 5 min on a critical endpoint → trigger rollback ([rollback.md](./rollback.md)). 3. Else cross-check alert thresholds in [contracts/events-and-projections.md](../architecture/contracts/events-and-projections.md). 4. Single-endpoint: capture `Server-Timing`, isolate slow stage, involve module owner before changes.

## C · Workers stalled
Identify queue → confirm Redis → inspect failed/exhausted backlog. Comms exhausted → ops retry per events contract. Documents/projection exhausted → `*.RECONCILE`/`*.BACKFILL`. Account projection jobs whose holder and cleanup-owned projection rows are all absent fail once as unrecoverable; use the structured `*.dead_lettered` log (`cid`, `queue`, `jobId`, `attemptsMade`) to confirm the permanent miss before removing the failed job. `documents` exhaustion ≥ 5 in 10 min is a paging condition; treat as B if platform-wide. Per-handler recovery actions: [reference/runbooks-coverage.md](../reference/runbooks-coverage.md).

## D · Data integrity
1. **Stop further writes** in scope. 2. → [backup-and-restore.md](./backup-and-restore.md) Postgres path. 3. Document binaries → blob path. 4. No traffic restore until `backup:restore:validate` reports zero failures. 5. Capture: trigger, incident ref, posture, validation, smoke.

## E · Security
1. **Do not delete logs.** Capture, then act. 2. Secret leak: rotate in Key Vault → redeploy → `tools/quality/scan-secrets.mjs` history. 3. RLS leak: `npm run test:tenant-isolation` against the env; inspect `setAccountScopeContext`. 4. Webhook auth bypass: `npm run test:webhook-inbound-auth`; rotate `INBOUND_WEBHOOK_SECRET` (GH env + runtime secret). 5. Open security review within 24 h.

## Required outputs (every incident)
Timeline · trigger metric/log · rollback/recovery actions · smoke result · evidence packet · follow-up (contract change / ADR / new guard / runbook update).

## Forbidden mid-incident
- Pushing fixes without `npm run gate:agent` passing.
- Restoring data without recording the chosen recovery point.
- Restarting workers in unknown order during rollback.
- Closing incident before smoke verification is green.

## Links
[deploy.md](./deploy.md) · [rollback.md](./rollback.md) · [backup-and-restore.md](./backup-and-restore.md) · [monitoring.md](./monitoring.md) · [contracts/events-and-projections.md](../architecture/contracts/events-and-projections.md)
