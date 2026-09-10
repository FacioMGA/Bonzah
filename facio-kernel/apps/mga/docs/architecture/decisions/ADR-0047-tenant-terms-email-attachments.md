---
title: ADR-0047 Tenant terms PDFs on outbound email
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-04
binding: true
---

# ADR-0047: Tenant terms PDFs on outbound email

## Status

Accepted.

## Context

Abbeygate correspondence must carry the legal terms for the MGA jurisdiction sending the email. The communications module is already the canonical outbound-email path: callers create a `CommunicationMessage`, the outbox emits `COMM.OUTBOUND_QUEUED`, and the worker delivers through `ProviderRouter` and `emailAdapter`.

Tenant jurisdiction is canonical on `Tenant.countryCode`, resolved by `getTenantConfig()` inside HTTP and worker ALS contexts. The delivery worker may not be able to re-resolve a tenant for every thread type, so the durable email row must carry the jurisdiction chosen at enqueue time.

## Decision

`CommunicationsService.createMessage` stamps `externalRefs.tenantCountryCode` on outbound email messages from `getTenantConfig().countryCode`.

`emailAdapter` appends the matching static terms PDF at delivery time:

- `PT` gets `TermsAndConditionsPortugal.pdf`.
- `CY` gets `TermsAndConditionsCyprus.pdf`.
- Other countries get no terms attachment until their PDF is explicitly configured.

The PDF bytes are loaded from backend static assets during delivery, not persisted as base64 on every message row. Existing message attachments are preserved, and an already-present terms filename is not duplicated.

## Consequences

All canonical outbound customer emails, including quote, welcome-pack, auth, payment, and composer emails, receive the tenant terms PDF. SendGrid raw, SendGrid template, and SMTP delivery paths must carry real MIME attachments.

Direct ad-hoc worker sends outside the communications spine remain out of scope and should not become a second customer-correspondence path.
