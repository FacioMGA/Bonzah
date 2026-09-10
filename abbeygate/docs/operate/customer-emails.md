---
title: Customer email delivery runbook
audience: operator
status: living
owner: platform-eng
reviewed: 2026-09-02
binding: true
---

# Customer email delivery runbook (ABY-268)

## When to read
- Customer says "I never got the email" (welcome pack, FNOL link, verification code), or BO questionnaire send reports `PRODUCT_TYPE_REQUIRED` after a program and binder were selected.
- Failure-zone banner shows `WELCOME_EMAIL_FAILED` or `FNOL_LINK_DELIVERY_FAILED`, or claim case shows `FNOL link delivery failed` (red) / `queued for delivery` (amber).

## What the queue / worker actually does
1. Code path (e.g. `sendFnolIntakeLinkEmail`, `sendIssuedPackWelcomeEmail`) calls `dispatchCustomerEmailTrigger`. That writes a row in `communication_messages` with `status: 'QUEUED'` and emits a `COMM.OUTBOUND_QUEUED` outbox event.
2. The outbox relay enqueues a BullMQ job for the `COMMUNICATION_OUTBOUND` worker (`backend/workers/handlers/COMMUNICATION_OUTBOUND.ts`).
3. The worker transitions the row to `SENDING`, creates a `communication_delivery_attempts` row, calls the provider (SendGrid / Twilio), and updates the message:
   - provider OK → `status: 'SENT'` (or `'DELIVERED'` if provider confirms via webhook).
   - provider failure → `status: 'FAILED'` on the attempt; message stays `SENDING` until retries are exhausted.
4. After `MAX_DELIVERY_ATTEMPTS = 3` failures the worker writes `Message.status = 'FAILED'` and emits a `COMM.MESSAGE_FAILED` audit event.

## Operator-visible surfaces
- **Claim case page** — `worksheet.comms.fnolLinkDelivery` shows `QUEUED` / `SENT` / `FAILED` / `UNKNOWN` per the canonical state on the `communication_messages` row. UI banner colour follows: amber while queued, white once sent, red on failure.
- **Public email OTP page** — only `sent: true` permits “on its way” copy. `sent: false` must show an honest retry state; a non-production `devCode` remains visible for QA.
- **Underwriting failure zone** — `loadFailureZoneSnapshot` emits `FNOL_LINK_DELIVERY_FAILED` (claim FNOL link) and `WELCOME_EMAIL_FAILED` (issued-pack welcome). Both are `alert` severity. `WELCOME_EMAIL_PENDING_SLA` is `watch` (issued docs exist but no `WELCOME_EMAIL_SENT` event after the SLA window).
- **Pino log lines** — search for `comms.worker.started`, `comms.provider.failed`, `comms.outbound.max_attempts_reached`.

## Triage
1. Confirm the recipient address against the claim / policy holder record. Bad address = permanent failure → fix via the policy holder edit (BO).
2. Inspect the latest `communication_delivery_attempts` row for the message via DB or `SELECT ... FROM communication_messages WHERE id = ...`. The `errorCode` / `errorDetail` columns identify the provider rejection (e.g. `SENDGRID_BOUNCE`, `INVALID_RECIPIENT`).
3. If error indicates a bounce, contact the customer on another channel and capture the corrected address before retrying.
4. Use the surface-specific resend (Claim case → **Resend FNOL link**; Communications tab → resend welcome email) once the address is good.
5. For `PRODUCT_TYPE_REQUIRED` or `PRODUCT_ASSIGNMENT_REQUIRED`, select and save both Program and Binder, then re-rate before resending. Re-rating synchronizes the effective Program/Binder authority pair before dispatch; it will not substitute another product for an incomplete policy.

## Retry semantics
- The worker retries automatically up to 3 attempts with provider-driven backoff; a retry requeues the same failed `communication_messages` row and the failure-zone clears once that row is no longer `FAILED`.
- Product standard letters are selected by the canonical trigger registry using `productCode` and, on placement, `isRenewal`: Travel and Immigration Medical have separate quotation, new-business, renewal confirmation, invitation and chaser templates; the product document-pack contract remains the attachment authority.

## UW referral notifications (internal, not customer-facing)
- Every product's REFERRAL outcome enqueues `EMAIL.UW_REFERRAL`: the motor rating chokepoint (`backend/products/motor/quotes/service.ts`, legacy flat payload) and the generic rating spine (`backend/modules/quotes/app/quoteRateService.ts`, canonical envelope — home/travel/health/manual re-rates). For Motor, this includes standard UW referrals, a BO excess override below the calculated minimum, and a declared vehicle value over twice the market value. The worker (`backend/workers/handlers/EMAIL.UW_REFERRAL.ts`) accepts both shapes.
- Recipients resolve from `UW_REFERRAL_EMAILS_BY_COUNTRY` in `tenantConfig.ts` via the policy's operating tenant — never from env vars. CY routes to Danny; PT to the underwriting trio (Matt, Ivan, Francisco); GR/ES/IT are serviced by Cyprus. Update that map to change a jurisdiction's underwriting recipients. Andy F is CC'd on his jurisdiction mailbox (`UW_REFERRAL_OVERSIGHT_CC_BY_COUNTRY`: `.cy` for CY-serviced, `.pt` for PT); `UW_REFERRAL_GLOBAL_CC` (monitoring inbox + Peter + Theodoros) is appended to every jurisdiction and deduped case-insensitively.
- Dispatch uses the internal `UW_REFERRAL_NOTIFICATION` template (trigger `UW_REFERRAL_RAISED`, `systemOnly`). Do not switch it to a customer-facing template: `UW_INFO_REQUEST` requires a `uw.url` the producers cannot supply, which silently skipped every referral email (Aug 2026 incident — Danny received nothing).
- The displayed quote reference links to the tenant-correct BO workspace at `/policies/:id#underwriting`; the plain-text fallback includes the full URL. Build it only after `runWithPolicyOperatingTenant` has bound ALS.
- A skipped dispatch now throws, so a misconfigured template/recipient surfaces as a failed+retrying job in the queue, not silence. Triage: search Pino for `email.uw_referral.dispatched` / the thrown `dispatch skipped` error.
## Public quote correspondence
- The public Home rate endpoint records `EMAIL.PUBLIC_QUOTE`; Travel can use the same public quote-email spine. The worker resolves the operating tenant, generates the regulated `QUOTE_PACK`, and dispatches every generated document through the existing customer-email spine — never from the rate request. An approved IPID is added separately only when the generated pack does not already contain one.
- A failed worker job is retryable and visible through normal queue/Sentry monitoring. Triage with `email.public_quote.dispatched` and `EMAIL.PUBLIC_QUOTE` error messages; do not claim delivery from the HTTP `queued` response. If the required IPID is unavailable, the worker fails closed and sends nothing.
## Online policy confirmation copies (internal)
- The customer confirmation CTA uses the sole customer-access route: `/verify-email?email=<policyholderEmail>&redirect=/client`. The holder must complete the `DASHBOARD_ACCESS` OTP before their policies and documents are shown. Do not send a signup `claimToken` URL: signup does not attach that token to the customer account. If documents arrive but a payment/email link shows no policies, verify this route and OTP flow; diagnose pack completeness separately with the document-generation runbook.
- Issued-pack welcome dispatch sends the customer email first, records `WELCOME_EMAIL_SENT`, then fans a separate internal staff notification to every mailbox in `ONLINE_POLICY_CONFIRMATION_COPY_EMAILS_BY_COUNTRY` in `tenantConfig.ts` (CY = Danny+Peter+Theo `.cy`; PT `.pt`; GR `.gr`; ES/IT disabled). The idempotency seed includes the recipient so the fan-out is not deduped to one send.
- The staff notification uses the dedicated `INTERNAL_SALE_NOTIFICATION` template (purchaser, product, policy, payment reference, source, correlation id) — it is NOT a duplicate of the customer welcome copy. Success/failure logs `email.internal_sale.sent` / `email.internal_sale.failed`; failure does not mark the customer welcome failed.
- The displayed policy number links to the tenant-correct BO workspace at `/policies/:id`, using the operating tenant `publicBaseUrl`; the plain-text fallback includes the same URL.
- Synthetic issuance-proof runs (`source: ISSUANCE_PROOF`) suppress the staff notification entirely (`email.welcome.internal_copy.suppressed_synthetic`) and mark the customer test email `[SYNTHETIC TEST — NOT A REAL POLICY]`.

## When to escalate to platform-eng
- `errorCode` indicates a provider-side outage (e.g. `SENDGRID_5XX`, repeated for multiple unrelated recipients).
- Worker logs show `comms.worker.failed` with stack traces (unhandled exception path).
- Failure zone shows the signal for more than one paid policy in the same minute window.
