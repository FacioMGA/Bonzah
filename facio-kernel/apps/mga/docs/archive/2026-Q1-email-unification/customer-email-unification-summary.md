---
title: Customer Email Unification Summary (frozen)
status: archived
owner: platform-eng
binding: false
---

> **Frozen-on:** 2026-05-03
> **Replaced by:** [`docs/product/email-triggers.md`](../../product/email-triggers.md)
> **Reason:** Historical summary of the customer email unification work completed in 2026 Q1. Kept for evidence; not current guidance.

# Customer Email Unification Summary

## What changed

- Introduced canonical customer email catalog and key model in `customerTemplateCatalog.ts`.
- Added unified customer template rendering with shared layout wrapper in `customerTemplateRenderer.ts`.
- Seeded canonical templates into `CommunicationTemplate` via `prisma/seed.ts`.
- Added customer trigger registry in `customerEmailTriggerRegistry.ts`.
- Added runtime `CustomerEmailTriggerService` for deterministic trigger dispatch with idempotency keys.
- Integrated communications logging for system-triggered sends using `systemEmailRecorder.ts`.
- Added renewal scheduler event handler `RENEWAL.EMAIL_SCAN` plus renewal cadence persistence via `RenewalEmailState`.
- Wired policy, quote, billing, and claims send flows to include communications SoR records.
- Updated comms template listing and UI typing to support `templateKey` and `systemOnly`.

## Canonical templates now present

- Quote: standard + bank transfer
- New business confirmation / welcome
- Renewal invite + chaser
- Payment request
- UW info request / questionnaire
- Document resend
- Cancellation confirmed
- Claims FNOL link
- Claims info/document request

## Flows wired

- Quote send / quote resend
- UW questionnaire and follow-up
- Payment request
- Welcome/new business and requested document resend
- Claims FNOL intake link
- Cancellation and additional customer-facing email worker handlers
- OTP verification/password-reset through canonical catalog templates
- Automated renewal invite/chaser dispatch from scheduled renewal scan

## Architecture policy

- No direct customer/OTP email send path remains in production notification modules; all route via unified trigger dispatch.

## Remaining known gaps

- Renewal cadence is currently invite (~30 days pre-expiry) and chaser (~14 days pre-expiry); thresholds are configurable through scheduler evolution if needed.
