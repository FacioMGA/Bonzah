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
The canonical list is the `CustomerTemplateKey` union in `customerTemplateCatalog.ts`. It includes generic templates plus `HOME_*`, `TRAVEL_*`, and `HEALTH_*` variants for quote, new-business confirmation, renewal confirmation, renewal invite, and renewal chaser. Operational templates cover quote follow-up, payment, UW, documents, claims, cancellation, endorsement capture, internal-sale notices, and authentication.

## Product lifecycle variants
| Product | Quote | New policy | Renewal confirmation | Renewal invite | Renewal chaser |
|---|---|---|---|---|---|
| Motor | `QUOTE_STANDARD` | `NEW_BUSINESS_CONFIRMATION` | `NEW_BUSINESS_CONFIRMATION` | `RENEWAL_INVITE` | `RENEWAL_CHASER` |
| Home | `HOME_QUOTE_STANDARD` | `HOME_NEW_BUSINESS_CONFIRMATION` | `HOME_RENEWAL_CONFIRMATION` | `HOME_RENEWAL_INVITE` | `HOME_RENEWAL_CHASER` |
| Travel | `TRAVEL_QUOTE_STANDARD` | `TRAVEL_NEW_BUSINESS_CONFIRMATION` | `TRAVEL_RENEWAL_CONFIRMATION` | `TRAVEL_RENEWAL_INVITE` | `TRAVEL_RENEWAL_CHASER` |
| Immigration Medical (`HEALTH`) | `HEALTH_QUOTE_STANDARD` | `HEALTH_NEW_BUSINESS_CONFIRMATION` | `HEALTH_RENEWAL_CONFIRMATION` | `HEALTH_RENEWAL_INVITE` | `HEALTH_RENEWAL_CHASER` |
| Golf | Not implemented in the platform; Drive files are manual reference only. |

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
  - **Product correspondence**: Home, Travel, and Immigration Medical use dedicated variants. Motor uses the generic lifecycle templates. A Home contents-limits notice is queued after the new-business or renewal confirmation when the canonical contents sum insured is €50,000 or more; it is advisory and does not alter underwriting eligibility.
  - **Cadence (ABY-85)**: `RENEWAL_INVITE` fires once a policy is within `28` days of expiry; `RENEWAL_CHASER` fires once within `7` days and only after at least `7` full days have elapsed since the invitation. Idempotency via `RenewalEmailState.{invite,chaser}SentAt` (no narrow day buckets); a missed invitation is caught up without sending both messages together.
  - **Visibility**: scan emits `renewal.email_scan.skip_missing_email` warn logs per policy that has no `quoteData.proposer.email`, and a structured `renewal.email_scan.completed` info log with eligible, deferred, sent and missing-email counters.
- **Claims**: FNOL link canonicalized; claims info / document requests pre-canonicalized for trigger coverage.

## Drive and database intake status (2026-09-04)
- Drive DOCX/HTML files are reference inputs, not runtime authority. Bracket placeholders are not executable template variables.
- Annual Multi-Trip Travel is selectable, priced, and rendered by the platform, but the approved document contract contains only the Single-Trip IPID. Quote email presentation fails closed for Annual; issued-pack selection is not yet trip-type-aware and can select the Single-Trip IPID. Do not import the Annual renewal DOCX files until an approved Annual IPID is wired end to end, or Annual is disabled by an owner-approved product change.
- Motor and Home HTML files are historical customer-message exports and may contain customer/payment data. Never seed them directly into `communication_templates`.
- Production has 15 legacy `communication_templates` rows; all are `DRAFT`, version 1, with no `lastDeployedSha`. They do not override the shipped code catalogue.
- Promotion to a DB override requires an owner-approved, sanitized template, exact variable-schema parity, preview evidence, `APPROVED` status, and a deployed SHA.

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
