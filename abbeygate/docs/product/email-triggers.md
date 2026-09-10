---
title: Customer email triggers
audience: developer
status: reference
owner: platform-eng
reviewed: 2026-07-31
binding: false
supersedes:
  - docs/architecture/email/email-template-canonicalization.md
  - docs/architecture/email/customer-email-trigger-matrix.md
  - docs/product/email/email-template-canonicalization.md
  - docs/product/email/customer-email-trigger-matrix.md
---

# Customer email triggers

## Canonical template keys
`QUOTE_STANDARD` · `HOME_QUOTE_STANDARD` · `QUOTE_BANK_TRANSFER` · `QUOTE_CHASER` · `NEW_BUSINESS_CONFIRMATION` · `HOME_NEW_BUSINESS_CONFIRMATION` · `HOME_RENEWAL_CONFIRMATION` · `RENEWAL_INVITE` · `HOME_RENEWAL_INVITE` · `RENEWAL_CHASER` · `HOME_RENEWAL_CHASER` · `HOME_HIGH_VALUE_CONTENTS_NOTICE` · `PAYMENT_REQUEST` · `UW_INFO_REQUEST` · `UW_REFERRAL_NOTIFICATION` · `DOCUMENT_RESEND` · `CANCELLATION_CONFIRMED` · `CLAIMS_FNOL_LINK` · `CLAIMS_INFO_REQUEST` · `CLAIMS_DOCUMENT_REQUEST` · `AUTH_EMAIL_VERIFICATION_OTP` · `AUTH_PASSWORD_RESET_OTP`.

## Trigger matrix
| Trigger | Template key | Auto / Manual | Comms Hub | Logged | Tracked |
|---|---|---|---|---|---|
| Quote sent | `QUOTE_STANDARD` | A+M | ✓ | ✓ | ✓ |
| Home contents notice (contents ≥ €50,000) | `HOME_HIGH_VALUE_CONTENTS_NOTICE` | Auto after new-business / renewal confirmation | ✓ | ✓ | ✓ |
| Quote follow-up | `QUOTE_CHASER` | A+M | ✓ | ✓ | ✓ |
| UW info required | `UW_INFO_REQUEST` | A+M | ✓ | ✓ | ✓ |
| Payment request | `PAYMENT_REQUEST` | A+M | ✓ | ✓ | ✓ |
| New business placed | `NEW_BUSINESS_CONFIRMATION` | A+M | ✓ | ✓ | ✓ |
| Renewal invite | `RENEWAL_INVITE` | A+M | ✓ | ✓ | ✓ |
| Renewal chaser | `RENEWAL_CHASER` | A+M | ✓ | ✓ | ✓ |
| Renewal scheduler scan (`RENEWAL.EMAIL_SCAN`) | `RENEWAL_INVITE` / `RENEWAL_CHASER` | Auto | n/a | ✓ | ✓ |
| Cancellation confirmed | `CANCELLATION_CONFIRMED` | A+M | ✓ | ✓ | ✓ |
| Document resend | `DOCUMENT_RESEND` | A+M | ✓ | ✓ | ✓ |
| Claims FNOL link | `CLAIMS_FNOL_LINK` | A+M | ✓ | ✓ | ✓ |
| Claims info request | `CLAIMS_INFO_REQUEST` | A+M | ✓ | ✓ | ✓ |
| Claims document request | `CLAIMS_DOCUMENT_REQUEST` | A+M | ✓ | ✓ | ✓ |
| OTP email verification | `AUTH_EMAIL_VERIFICATION_OTP` | Auto | system-only | ✓ | ✓ |
| OTP password reset | `AUTH_PASSWORD_RESET_OTP` | Auto | system-only | ✓ | ✓ |

Delivery is recorded as `CommunicationDeliveryAttempt`. All implemented today.

## Variant decisions
- **Quote**: standard + bank-transfer kept separate (operational payment paths differ).
- **Renewal**: invite + chaser are separate templates (cadence differs, style stays consistent).
  - **Home correspondence**: Home quote, issuance, renewal invite and renewal chaser use dedicated Beazley Home variants. Other products continue to use the product-neutral template for the same trigger. A Home contents-limits notice is queued after the new-business or renewal confirmation when the canonical contents sum insured is €50,000 or more; it is advisory and does not alter underwriting eligibility.
  - **Cadence (ABY-85)**: `RENEWAL_INVITE` fires once a policy is within `30` days of expiry; `RENEWAL_CHASER` fires once within `14` days. Idempotency via `RenewalEmailState.{invite,chaser}SentAt` (no narrow day buckets).
  - **Visibility**: scan emits `renewal.email_scan.skip_missing_email` warn logs per policy that has no `quoteData.proposer.email`, and a structured `renewal.email_scan.completed` info log with `invitesSent` / `chasersSent` / `skippedNoEmail` counters.
- **Claims**: FNOL link canonicalized; claims info / document requests pre-canonicalized for trigger coverage.

## UW referral routing (internal, not customer-facing)
- Quote lands in `REFERRAL` (age, claims, rate-table referral) → `EMAIL.UW_REFERRAL` outbox event. Producers: motor rating chokepoint (`products/motor/quotes/service.ts`) and the generic spine (`modules/quotes/app/quoteRateService.ts`) for home/travel/health.
- Recipients: the jurisdiction's underwriting handler from `UW_REFERRAL_EMAILS_BY_COUNTRY` (`backend/platform/tenant/tenantConfig.ts`) — CY: Danny · PT: Matt+Ivan+Francisco · GR/ES/IT: serviced by Cyprus (Danny). Andy F is CC'd per jurisdiction (`.cy`/`.pt`); yuval+Peter+Theodoros CC all. Explicit `payload.to` overrides.
- Renders via the dedicated internal `UW_REFERRAL_NOTIFICATION` template (system-only dispatch); idempotent per (policy, reasons). Never via `UW_INFO_REQUEST` — its required customer-facing `uw.url` makes the dispatch skip.

## Online policy confirmation copies (internal)
- After the issued-pack customer `NEW_BUSINESS_CONFIRMATION` is sent and recorded, the worker fans a separate internal copy to every mailbox in `ONLINE_POLICY_CONFIRMATION_COPY_EMAILS_BY_COUNTRY` (`tenantConfig.ts`): CY = Danny+Peter+Theo `.cy`, PT `.pt`, GR `.gr`; ES/IT have no copy while serviced by Cyprus.

## Layout + contract rules
- Customer bodies render through one shared wrapper (`customerTemplateRenderer.ts`) for header/branding, typography, footer/disclaimer.
- Required / optional variables live in template `variablesSchema`.
- Missing required variables surface in render metadata and persist into communication `externalRefs.template.missingVariables`.
- Provider-side dynamic template IDs are NOT the canonical content source for customer / OTP outbound.
