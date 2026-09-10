---
title: CardCorp Erica status update 2026-07-13
audience: operator
status: living
owner: platform-eng
reviewed: 2026-07-13
binding: false
---

# CardCorp Erica status update

Plain-text memo for Erica May Valencia:

Hi Erica,

Thanks for confirming the test notifications were received successfully on all
three endpoint URLs. From our side the CardCorp integration is wired for the
three Abbeygate production subdomains:

- cy.abbeygate.com
- pt.abbeygate.com
- gr.abbeygate.com

The implementation is configured as a per-country CardCorp setup: each country
has its own entity id and webhook secret, with the shared bearer token handled
by the deployment secret store.

The local verification suite is passing for CardCorp config resolution,
checkout creation, status verification, webhook ingestion/decryption, idempotent
checkout handling, policy issuance and issuance healing.

The two declined transactions you saw with "Invalid Card" look consistent with
an incorrect card number being entered during the payment attempt. The test card
we have on file for end-to-end verification is:

Card: 5442 9811 1111 1015
Expiry: any future MM/YY
CVV: any 3 digits
Name: any non-empty

Important implementation note: webhooks are active and audited, but settlement
is currently applied through the CardCorp status verification path after the
customer checkout flow. In other words, webhook receipt is not the canonical
trigger that marks the payment paid or issues the policy. If CardCorp requires
webhook-driven settlement, we should treat that as a follow-up change.

The only remaining proof is to run one end-to-end test card transaction per
country on the live/staging domains with the gateway credentials available in
that environment, then confirm policy issuance, documents and welcome email.
