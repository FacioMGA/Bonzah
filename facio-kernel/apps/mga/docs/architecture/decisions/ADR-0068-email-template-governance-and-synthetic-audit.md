---
title: ADR-0068 Email template governance and synthetic-run audit
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-10
binding: true
---

# ADR-0068: Email template governance and synthetic-run audit

## Status

Accepted. Follow-up to the email-safety work started under ADR-0067. Adds
approval governance to `CommunicationTemplate` overrides and a persistent
audit trail for synthetic (test/canary/preview) email sends.

## Context

Two email-estate weaknesses surfaced during the Aug 2026 incident review:

1. **A stale DB template could silently override the shipped design.** The
   customer email renderer prefers a `communication_templates` row over the
   code-backed catalog whenever one exists and is `enabled`. There was no
   versioning, no approval state and no record of who last edited a row or
   which build it belongs to — so a forgotten hand-edit could reach a real
   customer without review.
2. **Synthetic sends left no durable evidence.** The issuance-proof canary
   (and, later, the Email Preview & Testing Centre "send test") exercise the
   real email path. Nothing recorded what was sent, to whom, from which
   deployed build, or whether any created artefact still needed cleanup.

## Decision

1. **Governed overrides.** `CommunicationTemplate` gains `version`,
   `approvalStatus` (`DRAFT | APPROVED | REJECTED`), `approvedBy`,
   `approvedAt`, `lastEditor` and `lastDeployedSha`. `fetchTemplateOverride`
   applies a DB row ONLY when `approvalStatus == 'APPROVED'`; any other state
   is refused (logged `email.template.override.refused_unapproved`) and the
   code-backed, approved canonical template is used instead. Approval
   invalidation is enforced in the database: a `BEFORE UPDATE` trigger on
   `communication_templates` resets an edited row to `DRAFT`, clears the
   approver metadata and bumps `version` whenever `subjectTemplate`/
   `bodyTemplate` change without an explicit same-write re-approval — so ANY
   writer (BO, seed, manual SQL) is covered, not one code path. The canonical
   seed re-stamps `approvedAt`, so shipping the approved design is not reset.
2. **Synthetic audit trail.** A new `synthetic_email_runs` table records every
   synthetic dispatch: deployed SHA, trigger, template key + rendered `version`,
   originating `messageId`, `operatingTenantId` (from ALS), recipients,
   delivery ids, result, cleanup status, source and correlation id.
   `recordSyntheticEmailRun` writes it best-effort at dispatch (`QUEUED`); the
   `COMMUNICATION_OUTBOUND` worker finalises `result` (`SENT`/`DELIVERED`/
   `FAILED`) + provider id keyed by `messageId`; and the issuance-proof
   lifecycle initialises `cleanupStatus = PENDING` and closes it to `DONE`/
   `FAILED` when it deletes the throwaway policy. An audit write/update never
   blocks or fails the underlying send.

## Email Preview & Testing Centre (wire)

A BO-only surface (`requireBO`) mounted at `/api/email-preview` lets staff
inspect the email estate from safe fixtures without creating any production
artefact. Contract:

- `GET /inventory` → `{ triggerTemplates: EmailInventoryItem[], directProducers:
  DirectEmailProducer[] }`. Trigger templates are previewable; `directProducers`
  lists system emails that bypass the trigger registry (build+send their own
  payload, e.g. `EMAIL.CARDOG_MODEL_SUGGESTION`) so the estate view is honest.
- `GET /preview?trigger|templateKey&jurisdiction` → renders the EFFECTIVE
  template dispatch would send (APPROVED DB override if present, else the shipped
  code design) for the selected jurisdiction, plus lint findings + governance.
- `GET /coverage` → lint/fixture status for every previewable template; the
  summary counts previewable templates and reports `directProducers` separately.
- `POST /test-send { trigger|templateKey, jurisdiction, toEmail }` → the ONLY
  mutating route. Sends a SYNTHETIC email (subject-stamped, banner) to an
  allowlisted test mailbox; pinned to the operator's operating tenant so
  branding matches the jurisdiction; never creates a policy/payment/claim.

## Consequences

- Ops can edit templates in the DB, but a change is inert until approved — no
  more silent overrides of the approved design.
- Preview/lint/coverage render the same effective (override-aware) template that
  dispatch sends, so an approved DB override cannot pass review here yet ship
  differently in production.
- Every synthetic run is queryable evidence (who/what/where/when/result),
  which the Email Preview & Testing Centre builds on.
- `synthetic_email_runs` is a cross-tenant OPERATIONAL log (canary/preview/
  worker legitimately span jurisdictions), so it uses bare `prisma`
  (`guard:cross-tenant-intentional`) rather than tenant RLS. `operatingTenantId`
  is the per-row jurisdiction FILTER, not an RLS boundary.
- The deploy SHA is read from `SENTRY_RELEASE` (the image tag surfaced by the
  Helm runtime configmap), falling back to CI SHAs then `unknown`.

## Alternatives considered

- **Keep enabled-only overrides, add a lint.** Rejected: a lint cannot stop a
  runtime DB row, and the failure mode is customer-facing.
- **Log synthetic runs to Sentry only.** Rejected: breadcrumbs expire and are
  not queryable for a cleanup/coverage report; a first-class table is durable.
