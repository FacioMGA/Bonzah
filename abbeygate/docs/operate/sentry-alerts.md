---
title: Sentry alert rules
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
---

# Sentry alert rules

Sentry MCP tools can read events but not configure rules. Apply each
rule below manually in the [facio alert settings](https://facio.sentry.io/alerts/rules/).
Agents should use `user-SentryFull` for Sentry reads and Linear MCP
(`plugin-linear-linear` when present) for issue reads/writes. Do not
start polling bridges; if Linear MCP is absent, report that limitation.

## Allowed (apply all five)

| # | Project | Trigger / filter | Threshold | Window | Action |
|---|---------|------------------|-----------|--------|--------|
| 1 | `abbeygate-react` | `event.type:error AND release:[current]` (aggregate `count_unique(issue)`) | `> 5` | 5 min | Slack `#abbeygate-alerts` + email `uriel@facio.io` |
| 2 | `abbeygate` | A new issue is created on `release:[current] AND environment:production` | `>= 1` | 5 min | Slack + email |
| 3 | `abbeygate-react` | `message:"Failed to fetch dynamically imported module"` | `> 20` | 1 h | email |
| 3.1 | `abbeygate-react` | `message:"reading 'default'" OR message:"evaluating '*.default'"` | `> 5` | 1 h | email |
| 4 | `abbeygate` | `level:error AND http.status_code:[500 TO 599]` | `> 10` | 5 min | Slack + email |
| 5 | `abbeygate` | `http.status_code:429 AND transaction:"PATCH /api/public-sessions/*"` | `> 5` | 15 min | email (low urgency) |
| 6 | `abbeygate` | `background.tag:sanctions.provider_unavailable` (aggregate `count()`) | `> 3` | 5 min | Slack `#abbeygate-alerts` + email `uriel@facio.io`, `yuval@facio.io` |

Rule 1 catches the ABY-240 stale-chunk class within minutes of a deploy.
Rules 3 and 3.1 catch the two stale-chunk surfaces (fetch-failed, lazy-default-undefined / `ABBEYGATE-REACT-5`).
Rule 5 catches a UI fan-out race like ABY-237.
Rule 6 catches the fail-closed sanctions class: quotes and binds being turned away because the screening provider is unreachable. A spike here means online sales have stopped — the Aug 2026 outage ran for days because a 503 turn-away is not a crash and reached no error alert.

The client deliberately drops only the exact Android WebView `Java object is gone` bridge noise when it is frameless or carries a `navigation_performance_logger_android` origin, even if Sentry appends a capture frame. A first-party-only event stays reportable (ADR-0087, ABY-491).

## Forbidden

- Adding raw-event count alerts on `abbeygate` — the queue dispatcher
  emits known `ABBEYGATE-7` noise that would spam the channel.
- Disabling Rules 1 or 4 to chase a noisy false positive — adjust the
  filter, never widen the threshold.
- Pointing alerts at any inbox other than the on-call rotation; ad-hoc
  individual emails strand the alert when that person is off.

## Escalation

If an alert fires:

1. Open the linked Sentry issue and check `release` + `transaction`.
2. If the release tag matches the active deploy SHA, page the deploy
   author via Slack DM before any rollback decision.
3. Confirm the alert is still firing after 5 minutes. If yes, follow
   the [pre-deploy smoke checklist](./pre-deploy-smoke-checklist.md)
   in reverse to identify the most recent merge that touched the
   affected surface.

These alerts are reactive. Pair with the pre-deploy smoke checklist
for prevention; neither layer is sufficient alone.
