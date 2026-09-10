---
title: ADR-0008 Accounts360 projections and health contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# ADR-0008: Accounts 360 Projections and Health Contract

## Status

Accepted

## Context

The current `/accounts` feature behaves like a thin policy-holder directory. It does not expose cross-domain relationship signals needed by operations teams (portfolio posture, claim exposure, billing risk, communications recency).

At the same time, the platform already enforces:

- strict module/layer boundaries (`http -> app -> domain -> infra`)
- projection-first read performance patterns (LIGHT vs FULL)
- consistent BO UX paradigms in policy list and policy detail tabs

Accounts 360 requires a customer-centric read model without turning the platform into a generic CRM and without moving business computation into React.

## Decision

Build Accounts 360 as a projection-backed read workspace with explicit contracts.

### 1) Module ownership

- Create `backend/modules/accounts360/` as the read authority for account-relationship views.
- Keep account identity/contact mutation flows in existing account routes for now.
- Accounts 360 module owns:
  - projection schemas
  - projection reducers/builders
  - read endpoints and DTO contracts
  - backfill/reconcile jobs for projection correctness

### 2) Projection set

Accounts 360 reads are served from dedicated projections:

- `account_summary_projection`
- `account_portfolio_metrics`
- `account_alerts_projection`
- `account_activity_feed`

These projections are built from policy, claims, billing, communications, document, and contact signals.

### 3) Health scoring contract

Health is a projection field, never UI-derived.

Allowed values:

- `HEALTHY`
- `ATTENTION`
- `AT_RISK`

Rules are computed in backend domain logic and persisted with:

- `healthStatus`
- `healthScore` (numeric)
- `healthReasons[]` (normalized reason codes)
- `healthRuleVersion` (for traceability and safe re-tuning)
- `computedAt`

### 4) API contract

Expose read APIs under `GET /accounts360/*` for:

- list/index
- overview
- policies
- claims
- billing
- documents
- communications
- contacts
- feed

Endpoints return projection-backed payloads and use cursor/page semantics where appropriate.

### 5) Consistency and recovery

- Projection writes must be idempotent.
- A backfill process must rebuild projections from current source-of-truth data.
- A reconcile process must detect and repair drift.
- If projection data is temporarily unavailable, APIs may degrade gracefully but must not invent values in frontend.

### 6) Frontend style contract

Accounts 360 must reuse existing BO paradigms:

- list uses the same RecordList stack and style language as policies record list
- detail uses policy-style hash-synced tabs, tab classes, and interaction behavior

No new visual system is introduced for this epic.

## Consequences

### Positive

- Fast, high-signal account operations view with clear domain boundaries.
- Deterministic and testable health logic.
- Better UI consistency with existing policy and claims workflows.

### Trade-offs

- Additional projection lifecycle responsibilities (backfill, reconcile, observability).
- Temporary split between read ownership (accounts360) and legacy mutation routes.

## Rules

1. UI must not compute account health status directly.
2. Accounts 360 endpoint responses must come from projections or explicit backend aggregation services, not ad-hoc React joins.
3. Projection reducers remain domain logic; transport layers only map request/response.
4. Any health rule changes require `healthRuleVersion` increment and test updates.
5. Accounts list/detail styling must mirror policy record list and policy tab paradigms.
