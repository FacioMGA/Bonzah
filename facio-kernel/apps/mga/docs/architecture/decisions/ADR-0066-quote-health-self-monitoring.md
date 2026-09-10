---
title: ADR-0066 Quote-health self-monitoring
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-10
binding: true
---

# ADR-0066: Quote-health self-monitoring

## Status

Accepted

## Context

From 7 Aug 2026 online quoting was down for days and nobody was paged. The
sanctions/AML screening gate failed closed and returned a tidy HTTP 503 for
every quote. Because a 503 turn-away is a normal response, not a thrown error,
crash-based alerting (Sentry error rules) never fired. The one synthetic canary
that might have caught it (`issuance-proof`) had been disabled. A system that
cannot sell must know it and say so — silently refusing customers is the worst
possible failure mode for the business.

## Decision

Quote availability is a first-class monitored signal with two independent
layers, so a "customers cannot get a price" condition always reaches a human.

1. Turn-aways are visible. When the sanctions gate fails closed
   (`provider_unavailable`/`error`), `SanctionsService` emits a rate-limited
   Sentry event tagged `sanctions.provider_unavailable`. `sentry-alerts.md`
   rule 6 pages on a spike (Slack `#abbeygate-alerts` + human email).
2. Sellability is actively proven. A credit-free canary
   (`tools/quality/ops/prove-quote-health.ts`, CronJob `quoteHealth`, every
   5 min) prices a golden-fixture application through the product engine for
   each product; any failure emails `ISSUANCE_PROOF_ALERT_TO` and fails the run.
3. The canary must not consume paid screening credits; the compliance-gate
   dimension is covered by layer 1 from real traffic, not by probing Creditsafe.
4. Failure alerts go to a human inbox; routine synthetic side-effects (e.g. the
   issuance-proof welcome email) go to a non-human mailbox. See
   `docs/operate/quote-health-canary.md` and `monitoring.md`.

## Consequences

- A sales-stopping outage surfaces in minutes, not days, from either the engine
  side (canary) or the compliance-gate side (fail-closed Sentry signal).
- Neither layer weakens ADR-0043 fail-closed screening; they only observe it.
- New products inherit coverage automatically via the product registry; add the
  product code to `QUOTE_HEALTH_PRODUCTS` if scoping the canary.
