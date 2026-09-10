---
title: Bonzah embedded rental demo runbook
audience: operator
status: living
owner: product-platform
reviewed: 2026-09-07
binding: false
---

# Bonzah embedded rental demo runbook

## Start

1. Install locked dependencies with `npm ci`.
2. Start the repository's normal local PostgreSQL and Redis dependencies.
3. Run the normal development stack with `npm run dev`.
4. Run the public Vite surface (`VITE_SURFACE=public npm run dev:frontend`) and open `/summit-rentals`.

For a database-independent reference receipt, run `PORT=3001 npm run demo:bonzah:serve`
and point Vite at it with `VITE_API_PROXY_TARGET=http://127.0.0.1:3001`.
This starts only the in-memory Bonzah reference routes; it is not an Abbeygate
production runtime.

The partner API defaults to bearer token `bonzah-demo-local-token` and partner
ID `summit-rentals-demo` outside production. Import both files from `postman/`
and select the local environment; it supplies the seeded local tenant
`abbeygate-cy`. Never use these credentials outside a local demo.

## Reset

With the API running, execute `npm run demo:bonzah:reset`. The command clears
all in-memory synthetic quotes, confirmations and idempotency records and
restores the deterministic sequence immediately. Override the URL or token
with `BONZAH_DEMO_BASE_URL` and `BONZAH_DEMO_RESET_TOKEN` when required.

## Presentation checks

- Corolla CDW is lower than RAV4; Tesla is higher.
- Porsche 911 is declined; the ambiguous luxury trim is referred.
- Selecting SLI is unavailable until RCLI is selected.
- The review and confirmation retain the quote ID and rule version.
- Postman retrieval returns the same snapshot as the browser.
- Repeated create/bind calls return the original quote/confirmation.

The store is intentionally process-local. Restarting the API resets it. A
persistent or production partner integration requires a new architecture
decision and canonical database persistence.
