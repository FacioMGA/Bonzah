---
title: Bonzah rental API contract
audience: developer
status: living
owner: product-eng
reviewed: 2026-09-08
binding: true
---

# Bonzah rental API contract

ADR-0094 owns simulation; ADR-0095 owns product rating; ADR-0096 owns the
Insillion provider boundary.

## Canonical ownership

`backend/modules/bonzah/app/quoteService.ts` owns quote identity, expiry,
idempotency, correlation, integrity and bind orchestration. HTTP adapters
delegate to it. Simulation uses the registered `RENTAL` runtime; Insillion mode
uses provider premiums and never applies synthetic rating factors.

## Partner boundary

Create/get/bind remain under `/api/v1/bonzah/quotes`. Policy reads and document
downloads use `/api/v1/bonzah/policies`. Partner calls require bearer auth and
`X-Partner-Id`; mutations require `Idempotency-Key`. Responses use
`{ success, data }` or `{ success, error }` and identify execution mode.

Quote risk keeps Facio ISO jurisdiction, vehicle and coverage inputs. The
provider mapper alone owns Insillion names, date formats, booleans and the
provisional `licence_no` spelling. Commercial, rideshare and delivery use
decline. SLI requires RCLI. PAI/PEI maps to Insillion PAI.

## Bind and provider authority

Bind requires the current snapshot, integrity token, payment evidence,
policyholder/licence/address data, required inspection recipient, booking
timezone and consents. In Insillion mode it finalizes the provider quote, pays
the exact returned amount, reads the issued policy, and proxies selected PDFs.
Provider identifiers are references and never replace Facio quote identity.

Unknown mutation outcomes require reconciliation and are not automatically
retried. Credentials and provider tokens never enter API responses or logs.
Raw PAN and CVC remain forbidden.

An idempotency slot is claimed before any outbound provider mutation and
settled after it. A repeat of a claim that is still in flight returns
`IDEMPOTENT_REQUEST_IN_PROGRESS`; a claim is released only when the failure
proves no provider state exists. Confirmation requires a settled payment
matching the finalized total, an issued policy number, and a document
identifier for every selected coverage:

| Code | Meaning |
| --- | --- |
| `IDEMPOTENT_REQUEST_IN_PROGRESS` | An earlier request with this key has not settled |
| `PACKAGE_COVERAGE_MISMATCH` | The package code and coverage selection disagree |
| `POSTAL_CODE_NOT_RECOGNISED` | The provider ZIP master has no such postal code |
| `POSTAL_CODE_STATE_MISMATCH` | The ZIP resolves to a different state than declared |
| `POSTAL_CODE_COUNTRY_MISMATCH` | The ZIP is not a United States postal code |
| `PROVIDER_PAYMENT_AMOUNT_MISMATCH` | The settled amount differs from the finalized total |
| `PROVIDER_PAYMENT_INCOMPLETE` | The provider recorded a partial or unsettled payment |
| `PROVIDER_POLICY_NOT_ISSUED` | Payment was accepted but no policy number was issued |
| `PROVIDER_DOCUMENTS_UNAVAILABLE` | The issued policy is missing a selected coverage document |
| `PROVIDER_RECONCILIATION_REQUIRED` | A mutation outcome is unknown and must be reconciled manually |

## Execution boundary

`simulation` is deterministic and visibly synthetic. `insillion` requires HTTPS
and configured credentials. Production activation additionally requires durable
provider-operation persistence and accepted sandbox evidence; process-local
state is not production authority.
