---
title: Document generation recovery
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-09
binding: true
---

# Document generation recovery (ADR-0017)

## When to read

Customer reports "stuck on generating documents", BO sees `customerOutcome: 'failed'`, or `ISSUED_PACK_*` audit events on the payment view.

## Triage (≤ 90 s)

1. `kubectl logs -n prod deploy/worker --tail=200 | rg "issued_pack.handler"` — find `generation_failed` or `missing_doc_types` line; capture `policyId` + `reason`. NOTE: doc generation runs in the **worker** pod, not the API pod (`Dockerfile.worker`, not `Dockerfile.api`).
2. `kubectl exec -n prod deploy/worker -- ls /app/backend/dist/products/{home,travel,motor}/documents/templates/` — every product must list its `*.html` templates. Empty = Dockerfile.worker `COPY` regression (see ADR-0017 + `guard:docker-asset-parity`).
3. `kubectl exec -n prod deploy/worker -- sh -c 'for d in home travel motor health; do find "/app/backend/dist/products/$d/documents/static" -maxdepth 1 -name "*.pdf" -print; done'` — confirm every contract-owned static PDF is present, including all three Motor `AB/S/1/2026` jurisdiction wordings.
4. `kubectl exec -n prod deploy/worker -- env | rg QUEUE_WORKERS_ENABLED` — must be `true`.
5. For `Unable to start a transaction in the given time`, inspect `WORKER_CONCURRENCY*` and `PRISMA_CONNECTION_LIMIT`. The three queue concurrencies share one process pool; their sum must remain below the connection limit.
6. For a BO attachment that stays on `about:blank`, verify the timeline opens a synchronous blank tab, clears `window.opener`, fetches `/api/documents/*` through the authenticated binary client, and then navigates that retained tab to the blob URL. A blank tab plus a successful document API response indicates the popup handle was lost, not a generation failure.
7. For BO access failures, verify inline requests use `?inline=1`: staff with `documents.view` may open them, while attachment downloads require `documents.download`.
8. For customer portal access, verify the document is in a customer correspondence pack (`QUOTE_PACK`, `ISSUED_POLICY_PACK` or `ENDORSEMENT_PACK`) and not the BO-only `CREDITSAFE_SANCTIONS_REPORT_PDF`. Quote-pack types are product-owned and must not be inferred from a filename suffix.

## Recovery

- **Approved static PDF replacement** → preserve the jurisdiction-owned runtime filename, advance its `assetVersion`, pin the approved source SHA-256 in the product test, inspect every rendered page, record actual page geometry, and run runtime/Docker asset parity before release. Preserve the exact approved bytes unless the document owner explicitly approves normalization; mixed page sizes must be reported, not silently rewritten. For Home, verify every configured territory × proposer-domicile pair together so schedule references and attached wordings cannot drift.
- **Templates / static PDFs missing in WORKER image** → rebuild + redeploy. `guard:docker-asset-parity` enforces api↔worker COPY parity at CI time; `startupValidation.ts` fails the worker pod boot if any required asset is missing.
- **Worker not running** → set `QUEUE_WORKERS_ENABLED=true` on the worker deployment + restart. Until then, `attemptIssuanceHealForPolicy` retries each polled readiness check.
- **Prisma transaction acquisition exhausted** → clear `WORKER_CONCURRENCY_NOTIFICATIONS`, `WORKER_CONCURRENCY_DOCUMENTS`, and `WORKER_CONCURRENCY_DATA_SYNC`; then clear `WORKER_CONCURRENCY` to use the pool-derived default (or set a reviewed lower value) and restart workers. Verify the active per-queue sum is below the effective `DATABASE_URL` `connection_limit` (which overrides `PRISMA_CONNECTION_LIMIT`). Do not raise `PRISMA_TENANT_TX_MAX_WAIT_MS` alone; that only waits longer for the same saturated pool.
- **Per-policy recovery (failure already audited)** → trigger `enqueueIssuedPolicyPackStandalone({ policyId })` from a one-off task; the readiness evaluator auto-flips `failed` → `pending` → `issued` once a new doc lands with `generatedAt` newer than the audit row. A replay completes the active issued-pack version by document type, retaining its original template/asset evidence even when a later asset release exists; it must not create a second customer-visible pack. Superseded rows remain audit-only.

## Manual end-to-end verification (CardCorp test card)

Use the CardCorp test card to drive a full happy path through the public wizard before signing off any doc-gen change:

```
Card:   5442 9811 1111 1015
Expiry: any future MM/YY
CVV:    any 3 digits
Name:   any non-empty
```

Steps: pick a tenant (e.g. `abbeygate-cy`) → start a MOTOR quote → run through the wizard to the payment step → enter the test card → wait ≤ 30 s for the wizard to advance to the dashboard. Check the policy's Documents tab — the dynamic schedule must show that client's endorsements and the issued pack must include the matching jurisdiction's `AB/S/1/2026` wording. Repeat the required-document check for HOME and TRAVEL.

If the wizard surfaces `documents_failed` instead of advancing, the recovery surface itself is working as designed — go back to **Triage** above to find why the worker permanently failed.

## Links

- Contract: [contracts/products.md](../architecture/contracts/products.md) (canonical issuance gate)
- Decision: [ADR-0017](../architecture/decisions/ADR-0017-issue-readiness-failed-terminal-outcome.md)
- Related: [contracts/events-and-projections.md](../architecture/contracts/events-and-projections.md) · [ADR-0013](../architecture/decisions/ADR-0013-canonical-issuance-spine-outbox.md)
