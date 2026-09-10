---
title: ADR-0094 Manual approval completion contract
audience: architect
status: living
owner: product-platform
reviewed: 2026-09-03
binding: true
---

# ADR-0094: Manual approval completion contract

## Context

An underwriter may approve a referral before a customer completes
product-specific declaration fields. Shared lifecycle code must preserve that
approval without naming Home or any other product field.

## Decision

`IProductAdapter.getManualUwApprovalCustomerCompletionPaths()` is the
canonical product-owned contract for those completion-only fields. The shared
rating spine hashes every other risk, cover, underwriting decision and
authority input. MBE authority is the canonical rating-normalized configuration,
not its operational persisted JSON shape. Product-owned referral overlays are
part of the adapter's fresh rating result, never shared approval logic. Adapters
with no deferred customer declaration return `[]`.

The domain-owned coverage-selection contract and persisted override context are
the inputs used for both rating and readiness re-evaluation. Binder-product
authority limits are part of the approval fingerprint.

## Consequences

The shared workflow cannot add product-specific exclusions. A changed approval
scope fails closed and requires a new underwriter decision. BO may reapprove a
stale quoted approval only after the canonical readiness check identifies that
state and the fresh rate remains referred. Approval expiry from either quoted
or payment-pending is a lifecycle transition; payment-pending expiry cancels
the pending CardCorp checkout and unlocks the stale payment state. Cancellation
is terminal across verification, application and idempotent checkout reuse.
Rating writes version-check the current policy-state snapshot before recording
an approval, so a concurrent customer save fails the approval without losing
either risk change.

## Links

- `backend/modules/policy/domain/productContracts.ts`
- `backend/modules/policy/app/productRegistryService.ts`
- `backend/products/motor/underwriting/referralOverlays.ts`
