---
title: ADR-0057 Underwriting referral worklist projection
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-31
binding: true
---

# ADR-0057: Underwriting Referral Worklist Projection

## Status

Accepted.

## Context

Back-office managers need referral queues to show why a risk referred, which
questionnaire answers triggered it, and where the customer can resume the quote.
The canonical meaning of referral remains `underwritingAnalysis.triggers[]`;
duplicating trigger interpretation in policy-list UI would fork that spine.

## Decision

Policy list responses may expose a compact referral worklist projection built
from `underwritingAnalysis.triggers[]`, captured field answers, and the policy's
public customer link. The projection is read-only UI context. It MUST NOT create
new trigger meaning, override the underwriting outcome, or invent missing field
answers.

## Consequences

- Referral queue UI can display manager-actionable context without parsing raw
  policy snapshots on the frontend.
- Trigger definitions stay owned by product underwriting automation and the
  shared underwriting-analysis contract.
- If the projection lacks a field answer or customer link, the UI surfaces that
  absence; it does not fill defensive defaults.

## Links

- Contract: `docs/architecture/contracts/underwriting-analysis.md`.
- Projection owner: `backend/modules/policy/app/read/listPolicies.mapper.ts`.
