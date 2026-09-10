---
title: ADR-0096 Open Market externally issued policy lifecycle
audience: architect
status: living
owner: product-platform
reviewed: 2026-09-04
binding: true
---

# ADR-0096: Open Market externally issued policy lifecycle

## Context

Open Market proposals are assembled and issued by an external market. A
customer payment proves acceptance, but does not itself prove that the
external insurer has issued cover or supplied the authoritative document set.

## Decision

1. The Open Market product adapter declares the external-issuance workflow.
   Shared payment code reads that declaration; it must not branch on a product
   name.
2. A paid accepted Open Market proposal enters
   `AWAITING_EXTERNAL_ISSUANCE`. It records the paid acceptance and notifies
   the jurisdiction's managers, but creates neither an INCEPTION transaction
   nor an issued policy number, certificate, customer document pack, or
   welcome email.
3. A permitted manager completes external issuance through one canonical
   command, supplying the external issued documents. The command re-runs the
   normal fail-closed sanctions and issue-readiness controls, binds the policy,
   records the supplied documents as the issued pack, then activates the
   policy and opens normal client-document/email access.
4. Cancellation and refund remain explicit existing operations; they are not
   inferred from an unissued external placement.

## Consequences

- Payment cannot expose an unissued policy or invented document pack.
- The workflow is product-declared and can be adopted by another authorised
  product without a shared product-name branch.
- The external-issuance command is auditable and idempotent; orphan uploads
  are not treated as issued-policy documents.

## Links

- `backend/modules/payments/app/cardcorpPolicyIssuanceService.ts`
- `backend/modules/policy/domain/productContracts.ts`
- `backend/modules/policy/app/IssuePolicy.ts`
- `backend/modules/documents/`
