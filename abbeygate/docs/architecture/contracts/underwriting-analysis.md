---
title: Underwriting analysis contract
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# Underwriting analysis — binding contract

## Governs
`underwritingAnalysis` — the authoritative BO underwriting-analysis payload for motor and home policies.

## Allowed
- Backend owns `lane`, `outcome`, `triggers[]`, `pricingAdjustment`, and explanation text.
- Payload is built from configured UW automation decision + pricing calculation trace.
- Yellow / red overlays that change quoting (excess override approval, declared-value mismatch) surface as triggers in the same payload.
- BO field-flag summaries may count unique visible questionnaire fields referenced by `triggers[].fields`; they MUST NOT treat `triggerCount` as a field count.
- BO referral worklists may expose a compact projection of `triggers[]`, field answers, and customer link; they MUST NOT re-derive trigger meaning.

## Shape
```ts
type UnderwritingAnalysis = {
  lane: 'green' | 'yellow' | 'red';
  outcome: 'accept' | 'referral' | 'decline';
  triggerCount: number;
  triggers: Array<{ code; message; lane: 'yellow'|'red'; severity: 'medium'|'high'; fields: string[]; explanation }>;
  pricingAdjustment: { type: 'automatic'|'manual'|'none'; valuePct: number; explanation; sources: string[] };
};
```

Every surfaced item answers: what fired · why it matters · whether pricing changed automatically or needs manual review.

## Forbidden
- BO UI reconstructing pricing or trigger meaning from raw `quoteData`, partial `uwDecision`, or frontend heuristics. Render `underwritingAnalysis` directly.
- Using `policyAutoRiskModel` as a source for BO pricing / trigger summaries. It is a per-field questionnaire-chip helper only.
- Hiding yellow / red overlays. If it changes behaviour, it surfaces as a trigger.

## Escalation
- **Write an ADR** to: add a top-level field, change the `lane` / `outcome` enum, add a `pricingAdjustment.type` beyond `automatic | manual | none`.

## Links
- Related: [products.md](./products.md) · [product-engine-authority.md](./product-engine-authority.md)
