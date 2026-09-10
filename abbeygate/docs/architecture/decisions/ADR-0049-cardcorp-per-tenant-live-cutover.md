---
title: ADR-0049 CardCorp is per-tenant; facio.io is staging, abbeygate.com is production
audience: architect
status: living
owner: platform-eng
reviewed: 2026-07-06
binding: true
---

# ADR-0049: CardCorp per-country credentials + facio.io→staging / abbeygate.com→prod split

## Status

Accepted. Enables the go-live cutover: card processing that was previously a
single shared OPPWA **test** channel becomes a per-country **live** channel on
`*.abbeygate.com`, while `abbeygate-*.facio.io` becomes the staging surface.

## Context

CardCorp (OPPWA white-label) issued Abbeygate one live channel **per country**:
each of CY / PT / GR has its own `entityId` and its own AES-GCM webhook
decryption secret, but all three share one bearer token per environment. The
codebase modelled CardCorp as a single global channel: two duplicate
`getCardcorpConfig()` copies (`policy/app/shared.ts`,
`payments/http/cardcorpPublicRouter.ts`) read a bare `CARDCORP_ENTITY_ID`, and
the webhook receiver read a bare `CARDCORP_WEBHOOK_SECRET`. There was no way to
serve three live entities from one deployment, and no test/live switch beyond a
base-URL env var.

## Decision

1. **One canonical resolver** — `backend/modules/payments/app/cardcorpConfig.ts`
   owns all CardCorp config. `getCardcorpConfig(countryCode?)` defaults the
   country to the ALS operating tenant (`getTenantConfig().countryCode`). The two
   duplicate copies are deleted; `shared.ts` re-exports the canonical one.
2. **Per-country keys, no global fallback** — `CARDCORP_ENTITY_ID_<CC>` and
   `CARDCORP_WEBHOOK_SECRET_<CC>` (CC ∈ CY|PT|GR|ES); shared
   `CARDCORP_BEARER_TOKEN`. A missing per-country key yields `entityId=''`
   → `501 NOT_CONFIGURED` at checkout (fail closed). No fallback to a bare
   global key or to another country's credentials (`no-defensive-fallbacks`).
3. **`CARDCORP_ENV` test|live** — selects the OPPWA host
   (`eu-test`/`eu-prod.oppwa.com`, overridable via `CARDCORP_BASE_URL`) and, in
   `live`, **omits** the OPPWA `testMode` form param entirely.
4. **Webhook picks the key by trying all** — the receiver has no operating
   tenant, so it attempts each configured per-country secret; AES-GCM's auth tag
   verifies the correct channel (a wrong key throws), so events are never
   mis-attributed. The decrypted channel country is recorded on the outbox event.
5. **Health + boot** — `/health/integrations` reports `cardcorp` as configured
   only when the shared bearer plus at least one full per-country pair is set,
   and adds a `sendgrid` row (email outages were previously invisible).

## Topology

Production serves `cy|pt|gr.abbeygate.com` (live keys, `CARDCORP_ENV=live`);
`abbeygate-*.facio.io` stays live on prod **during transition only**. Staging
serves `*.staging.abbeygate.com` (test keys, `CARDCORP_ENV=test`), and will take
over `abbeygate-*.facio.io` as the final DNS-coordinated step. `resolveTenant.ts`
already maps all of these hosts to the jurisdiction slug — the slug identifies
the tenant, never the environment; isolation is namespace + DB + secret.

TLS: AGIC binds one cert per ingress, so prod renders two ingresses — the main
one serves the `facio.io` hosts on `*.facio.io`, and `abbeygateIngress` serves
`cy|pt|gr.abbeygate.com` on the `*.abbeygate.com` wildcard cert.

## Consequences

- Deploying this code **requires** the per-country secrets to exist in the target
  namespace first (staging sets all three `_CY/_PT/_GR` to its single test
  entity). The merge is therefore infra-gated — see
  `docs/operate/cardcorp-live-cutover.md`.
- No data migration. `Tenant.publicBaseUrl` is set per environment (prod →
  `*.abbeygate.com`, staging → `*.staging.abbeygate.com`) as an operator step.
- The `facio.io`→staging move (prod drops the four `facio.io` listeners; staging
  adds them) is a separate DNS-coordinated cutover, not done here.

## Refused alternatives

- **Per-country → global `CARDCORP_ENTITY_ID` fallback** during migration —
  banned by `no-defensive-fallbacks`; staging instead sets the per-country keys
  explicitly to its one test entity.
- **`if (country === 'PT')` branches** in checkout/webhook — replaced by the
  data-keyed resolver (`contract-spine`).
- **Resolving the webhook secret from the request host** — brittle behind the
  App Gateway; the try-all-secrets approach is authenticated by GCM and
  host-agnostic.

## Sources

- `backend/modules/payments/app/cardcorpConfig.ts` — canonical resolver.
- `backend/modules/payments/app/cardcorpWebhookProcessingService.ts` — per-country decrypt.
- `backend/platform/config/integrationHealth.ts` — cardcorp + sendgrid rows.
- `infrastructure/k8s/helm/abbeygate/values.yaml` — per-country secret keys + hosts.
- `docs/operate/cardcorp-live-cutover.md` — the sequenced runbook.
