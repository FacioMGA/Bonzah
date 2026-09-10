---
title: ADR-0051 Pre-go-live production test-data reset (one-time, backup-guarded exception)
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-21
binding: true
---

# ADR-0051: Pre-go-live production test-data reset

## Status

Accepted (2026-07-21) — approved by the repo owner for the initial CY/PT/GR home go-live.
Execution remains gated on the operational guardrails below (backup green, tenant allowlist,
import-first invariant, explicit env opt-in).

## Context

Abbeygate is preparing its first production go-live for the home (property) book on
`abbeygate-cy`, `abbeygate-pt` and `abbeygate-gr`. Before go-live the customer ran quote/bind
tests directly against the production database. Those test rows are indistinguishable to
downstream reporting from real business and would otherwise appear in the first BDX and in
operational dashboards.

Production ground-truth (2026-07-21) corrected an earlier, unsafe assumption. "Untagged" is
NOT a safe definition of "test": the prod DB already holds large migrated books AND untagged
rows across every product — including real, ACTIVE Cyprus Immigration Health policies and
in-flight customer quotes created through go-live. Worse, the BDX migration stamped the
placeholder `bdx-import@import.local` on REAL migrated policies, so that address is also not a
test signal. The only operator-confirmed, unambiguous signal is an internal/seed proposer
email (`example`/`test` addresses, `@facio.io`, and `@abbeygate.{cy,pt,py,gr}`). "Test" is
therefore defined by the email predicate in `testDataReset.ts`, scoped further to untagged
rows as a second safety.

[bdx-recovery-rules.md](../../operate/bdx-recovery-rules.md) currently forbids destructive
wipes in production with "no exceptions". That rule exists to stop operators *correcting an
already-issued, real policy* by mutating/deleting rows instead of writing a `RiskTransaction`
(ADR-0007). The situation here is categorically different: a **one-time reset of rows that
were never real business**, on tenants that are **not yet live**, before the first reporting
period. Doing this cleanly is better than permanently carrying test PII plus a "test" filter
branch through every reporting query (the soft-exclude alternative). But because the contract
is absolute, the exception must be explicit, bounded, and reversible — not a quiet bypass.

## Decision

Authorize a **single, bounded, backup-guarded** destructive test-data reset in production,
distinct from the still-forbidden mid-life correction wipe.

1. **Reversibility is the safety model.** A verified logical/PITR backup is taken and a restore
   is validated into a verification target immediately before the reset (`backup:posture:check`,
   `backup:restore:validate`). The reset is recoverable within the [rollback.md](../../operate/rollback.md)
   targets (data restore RTO <= 4h, RPO <= 15 min). No soft-delete column is added.
2. **Test-email predicate, not "untagged".** A row is deleted only when its proposer email
   matches a `TEST_EMAIL_PATTERN` (internal/seed addresses) AND it is untagged. The untagged
   condition is a second safety, never the selector. The untagged rows that do NOT match the
   predicate (real/other emails) are reported for a separate human decision and never deleted.
3. **Tooling, not ad-hoc SQL.** Deletion goes through
   [`wipe_non_bdx_test_policies.ts`](../../../tools/migrations/wipe_non_bdx_test_policies.ts)
   (domain: [`testDataReset.ts`](../../../backend/modules/policy/app/bdxImport/testDataReset.ts)),
   which reuses the canonical `cleanupImportedPolicy` cascade — the same primitive the staging
   wipe uses.
4. **Hard guardrails (all required to commit):**
   - Tenant allowlist `{abbeygate-cy, abbeygate-pt, abbeygate-gr}`. `abbeygate-es` (Spain) is
     excluded from the go-live and therefore from any reset — it has no imported book, so every
     row there is untagged and a reset would empty it.
   - Test-email predicate + untagged only; the matched set and its distinct emails are
     previewed and reviewed before commit, and the non-matching untagged remainder is reported.
   - Explicit `ALLOW_DESTRUCTIVE_TESTDATA_RESET=1` env opt-in plus `--commit`; dry-run by default.
   - A green backup posture and a validated restore recorded as evidence beforehand.
5. **Scope is single-use.** This authorization covers only the initial CY/PT/GR home go-live.
   Any later production data correction reverts to the ADR-0007 correction-endorsement path.

## Consequences

- [bdx-recovery-rules.md](../../operate/bdx-recovery-rules.md) is amended on acceptance to add a
  single "Pre-go-live reset (one-time, ADR-0051)" carve-out row pointing here; the general
  "never wipe in production" rule otherwise stands unchanged.
- The reset is auditable (tool output + backup/restore evidence in the go-live report).
- If sign-off is withheld, the fallback is soft-exclude (schema flag + reporting filters), which
  keeps test PII in production and adds permanent query complexity — explicitly the less-preferred
  option.

## Alternatives considered

- **Soft-exclude / tombstone** — reversible, no contract breach, but leaves customer test PII in
  production forever and forces a `WHERE NOT test` branch into every BDX/reporting query.
- **Correction endorsement per row** — the sanctioned mid-life path; wrong tool here because the
  rows are not real policies and it would emit cancellation rows into the first BDX.
- **Fresh empty production database** — cleanest in theory but the tenants/config/binders are
  already provisioned in prod; a scoped reset is lower-risk than re-provisioning.

## Links

- Contract: [bdx-recovery-rules.md](../../operate/bdx-recovery-rules.md) ·
  [backup-and-restore.md](../../operate/backup-and-restore.md) · [rollback.md](../../operate/rollback.md)
- Decisions: [ADR-0007](./ADR-0007-policy-versioning-lifecycle-primitives.md) ·
  [ADR-0049](./ADR-0049-cardcorp-per-tenant-live-cutover.md)
- Tools: [wipe_non_bdx_test_policies.ts](../../../tools/migrations/wipe_non_bdx_test_policies.ts) ·
  [split_bdx_by_tenant.ts](../../../tools/migrations/split_bdx_by_tenant.ts) ·
  [bdx-import-runner.mjs](../../../tools/migrations/bdx-import-runner.mjs)
