---
title: Bonzah Insillion operations
audience: operator
status: living
owner: product-platform
reviewed: 2026-09-08
binding: false
---

# Bonzah Insillion operations

## Enable sandbox mode

Set `BONZAH_EXECUTION_MODE=insillion`, the sandbox HTTPS base URL, username, password,
and a timeout between 1000 and 60000 milliseconds. Supply credentials through
the deployment secret provider. Restart the API and confirm startup validation.

## Acceptance sequence

1. Create a CDW-only quote and record Facio quote ID, correlation ID and total.
2. Create an RCLI plus SLI quote and confirm the dependency and provider rates.
3. In a non-production sandbox process, bind with test payment evidence, inspection recipient and IANA timezone.
4. Confirm provider quote, payment, policy and policy-number references.
5. Read the policy through the Facio partner endpoint.
6. Download every selected coverage PDF through the Facio proxy.
7. Repeat create and bind with the same idempotency keys; confirm no duplicate.

## Failure handling

`PROVIDER_RECONCILIATION_REQUIRED` means finalization or payment may have
succeeded but no reliable response arrived. Do not retry the mutation. Preserve
the correlation ID and request identity, check Insillion state, and reconcile
before allowing another attempt.

Authentication and master/policy reads may refresh once after 401. Repeated
authentication failure means credentials or account permissions need repair.

## Rollback

Set `BONZAH_EXECUTION_MODE=simulation` and restart. This restores synthetic demo
behavior; it does not reconcile or cancel any Insillion transaction.

## Launch gates

Do not enable production sales until durable tenant-scoped operation storage,
sandbox evidence, approved credentials, licence-key spelling, timestamps,
state values, rates, wording, payment authority and operations ownership are
accepted.

## Enforced safety boundaries and contract questions

- Mutations require `https://bonzah.sb.insillion.com` and a non-production process; there is no live override. HOSTED tokens are not customer-payment verification. Simulation rejects HOSTED payment claims.
- `/price-preview` is simulation-only; Insillion callers must use `/quotes` for provider pricing. Demo frontends remain simulation-only until their provider-specific fields and payment flow are integrated.
- Finalization attempts lock the quote across idempotency keys. Provider references are retained in process for reconciliation; restart loses them. Never restart to clear an uncertain outcome. The demo reset endpoint is disabled in provider mode.
- Calendar birthdays preserve their date; finalization timestamps use the supplied IANA timezone. Quote ISO timestamps must represent real instants with correct offsets, not local times mislabeled as UTC.
- ZIP masters accept the documented single object and `US`; daily rates parse the currency amount separately from the 24-hour label. Unknown response formats fail closed.
- Vercel mounts authenticated partner policy/PDF routes; production partner access requires an explicitly configured token. These are not public PDF links.
- Confirm with Bonzah: quote date-only vs timestamp examples, `licence_no` vs `license_no`, state formats, payment amount type, retry/reconciliation procedures, endorsement availability, and request/upload fields for licence images, VIN and rental metadata. The Word requirements file is product guidance, not an endpoint specification.
