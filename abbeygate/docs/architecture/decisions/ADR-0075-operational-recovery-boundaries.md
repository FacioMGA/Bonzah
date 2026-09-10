---
title: ADR-0075 Operational recovery boundaries
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-28
binding: true
---

# ADR-0075: Operational recovery boundaries

## Status

Accepted.

## Context

Recent Abbeygate production reports exposed several cases where a recoverable
delivery, navigation, or stale-client failure either lost operator intent,
escaped the canonical authenticated path, or suppressed the evidence needed to
diagnose a persistent fault. The fixes span surfaces, but share one rule:
recovery must preserve the business action and must not erase failure evidence.

## Decision

1. Internal notes target only the explicitly selected internal recipients;
   customer-channel consent filtering remains unchanged.
2. Tenant-originated email sets Reply-To to the tenant inbox while preserving
   the canonical communications adapter and tenant terms attachment.
3. BO and authenticated customer-portal document links use the authenticated
   binary client. Inline API-document actions open a new browsing context and
   never replace the application; external links are opened once without a
   retained blank popup.
4. Cash Sheet policy identifiers route to the canonical BO policy details
   surface and remain keyboard/screen-reader accessible.
5. Public Motor quote saves convert dropped-network failures into an explicit
   failed result and retry one 429 response using its bounded Retry-After value.
6. Stale Vite chunks receive one automatic reload. Sentry suppresses only the
   original recoverable event in that document while reload begins; the
   suppression state does not survive the reload. If reload is unavailable or
   the one-shot window is exhausted, the error boundary reports the failure to
   Sentry and presents recovery controls.
7. Operational report allocation skips a policy that disappeared before the
   assignment write instead of converting that race into a server error.
8. Behavior normalization accepts an optional eventType at the ingestion
   boundary and uses the canonical fallback without type laundering.
9. Paid CardCorp policies are reconciled on a bounded, tenant-scoped worker
   schedule. Candidate detection and replay delegate only to
   `attemptIssuanceHealForPolicy`; this recovery path never creates a second
   issuance or document-generation implementation and never depends on a
   customer revisiting a public quote URL.

## Consequences

- A successful local retry or reload is not closure evidence; deployed-SHA and
  user-flow or Sentry verification are still required.
- Secure document popup blocking may prevent display, but cannot navigate the
  operator away from Abbeygate.
- Retry behavior stays bounded to one attempt and a maximum five-second delay.
- Generated reference inventories continue to be produced only by the docs
  generator.
