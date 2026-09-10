---
title: ADR-0021 unit-full vitest suite is blocking on the agent gate
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-14
binding: true
---

# ADR-0021: unit-full vitest suite is blocking on the agent gate

## Status

Accepted

## Context

`tools/quality/agent-gate.sh` previously ran the full vitest suite
(~260 files, ~1140 tests) as a **warn-only** ratchet inside the `full`
mode (`run_unit_full_warn`). The function tee'd the output to
`artifacts/quality/unit-full-warn.log` and reported a summary, but it
never propagated the failure exit code; the gate continued green.

The visible cost: a `policyRepositoryCounts` test failed on May 7 and
sat un-fixed for a week. The errors-and-warnings cleanup audit
(this campaign) found it because the audit ran `vitest` directly,
not because the gate caught it. By the time PR 1.1 fixed the failure,
no human had been notified that the warn-rung was red.

PRs 1.1 through 6.1 of the cleanup landed every other test fix, every
guard ratchet, and the dead-code drain. The full vitest suite is now
zero-failures and stable, removing the operational reason the warn
rung existed.

## Decision

Promote `run_unit_full_warn` to a blocking step (renamed
`run_unit_full`) inside both the `default` and `full` modes of the
agent gate. A non-zero exit from `npm run test:full` now exits the
gate with the test runner's exit code.

An explicit escape valve is preserved for broken-tree work sessions:

```sh
AGENT_GATE_ALLOW_TEST_FAIL=1 npm run gate:agent
```

The escape valve restores the prior warn-only behaviour for that
single invocation and prints `WARN: test:full reported failures …
non-blocking via AGENT_GATE_ALLOW_TEST_FAIL=1`. The flag is **not** a
long-term toggle — every commit pushed without it must show a green
`test:full`, and the flag is not consulted by CI.

The artifact paths follow the rename for grep/log rotation:

| Before | After |
|---|---|
| `artifacts/quality/unit-full-warn.log` | `artifacts/quality/unit-full.log` |
| `artifacts/quality/unit-full-warn.summary.txt` | `artifacts/quality/unit-full.summary.txt` |

## Consequences

- A failing unit test in any branch fails the gate the next time
  someone runs `npm run gate:agent` — the May-7-style "it sat red for
  a week" scenario cannot recur silently.
- The `default` mode (the most common operator invocation) now
  exercises the full suite. Local gate runs grow from ~30s of
  contract-fast tests to ~60-90s including the full suite. The trade
  is intentional: surface failures earlier.
- The escape valve gives operators a clear, audit-able way to push
  through a known-bad tree (e.g. WIP refactors), but every use must
  be justified in the PR.
- The ADR-0010 rule that "if code and docs disagree, docs win" still
  applies — if a test pins obsolete behaviour (as
  `policyRepositoryCounts` did against `buildCustomerPolicyScopeOr`),
  the test is the bug, not the implementation.

## Follow-ups

- The CI workflow (`.github/workflows/`) already runs `npm run test:full`
  as a separate job; this ADR aligns the local gate with CI.
- Stage B for the `max-lines` ratchet (ADR-0020) and the dead-code
  baseline ratchets (PR 6.1) follow the same pattern: warn first,
  promote to blocking once the floor stabilises.
