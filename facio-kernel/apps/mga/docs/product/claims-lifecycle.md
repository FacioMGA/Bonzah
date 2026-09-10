---
title: Claims lifecycle standard
audience: developer
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
supersedes:
  - docs/architecture/CLAIMS_LIFECYCLE_STANDARD.md
---

# Claims lifecycle — binding contract

## Governs
The lifecycle truth used by Claims Desk: separates reporting/projection truth (backend, bordereaux) from operational UI truth (handler actions, lifecycle badges).

## Operational UI states (the only set the UI uses)
`PENDING` · `OPEN` · `UNDER_REVIEW` · `DENIED` · `CLOSED`. Implemented by `frontend/src/modules/claims/desk/model/selectors.ts`.

## Backend → UI mapping (first match wins)
| Backend projection truth | Operational UI state |
|---|---|
| `DENIED` or denial flag | `DENIED` |
| `PENDING` (intake not yet confirmed) | `PENDING` |
| `CLOSED`, `CLOSED_THIS_MONTH`, `CLOSED_RECOVERY_PURSUED`, `WITHDRAWN` | `CLOSED` |
| Phase `INVESTIGATION` / `DECISION`, status `REOPENED` | `UNDER_REVIEW` |
| All other active / open variants | `OPEN` |

## Action gating
| Action | PENDING | OPEN | UNDER_REVIEW | DENIED | CLOSED |
|---|---|---|---|---|---|
| Set / adjust reserve · record payment / recovery · appoint party · deny · close | — | ✓ | ✓ | — | — |
| Reopen | — | — | — | — | ✓ |
| Add note · add evidence | ✓ | ✓ | ✓ | ✓ | ✓ |

## Allowed
- Commands append claim domain events (`backend/modules/claims/domain/commands/*.ts`).
- Projection rebuilt from ordered claim events (`backend/modules/claims/domain/worksheetProjection.ts`).
- UI state derived from projection via the single selector contract.

## Forbidden
- Frontend deriving lifecycle from raw reporting status strings.
- Writing `UNDER_REVIEW` from UI commands (presentation-only state).
- Action gating bypassing the operational state mapping.
- Treating referral / approval as separate lifecycle states (they are contextual blockers).

## Command invariants
- **Deny** (`DENY_CLAIM`): block if `totalPaid > 0` OR `totalOutstanding > 0`. Required: `denialReason`, `summary`. Events: `CLAIM_DENIED`, `DENIAL_COMMUNICATION_REQUIRED`.
- **Close** (`CLOSE`): block if `totalOutstanding > 0` OR `recoveriesExpected + salvageExpected > 0`. Required: `closureReason`, `summary`. Event: `CLAIM_CLOSED`.
- **Reopen** (`REOPEN`): allowed only when operational state is `CLOSED`. Required: `reopenReason`, `summary`. Event: `CLAIM_REOPENED`.

Failure codes: `ACTION_NOT_ALLOWED_IN_STATE` · `DENIAL_INVARIANT_FAILED` · `CLOSURE_INVARIANT_FAILED` · `FNOL_NOT_CONFIRMED` · `REFERRAL_REQUIRED`.

## Open gaps (not silently deferred)
- PT holiday calendar is weekends-only until Abbeygate supplies the official calendar (ADR-0065).
- Segurnet/FIVA live transmission stays blocked until the external spec exists.
- Product `fullClaimForm.fields` are empty pending Uriel/Peter field lists.
- Client does not mount claim-form-package / developments / assignments / reserves; handlers use BO worksheet commands.

## Escalation
- **Write an ADR** to: add a new operational UI state, add a backend projection status, change deny/close/reopen invariants.

## Links
- `PENDING` state ratified by [ADR-0058](../architecture/decisions/ADR-0058-freshness-review-contract-amendments.md)
- Surfaces (Claims UI contracts): [surfaces.md](../architecture/contracts/surfaces.md)
- Display labels: [frontend-display-labels.md](./frontend-display-labels.md)
