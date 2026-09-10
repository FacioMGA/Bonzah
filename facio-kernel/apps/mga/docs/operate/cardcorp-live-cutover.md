---
title: CardCorp live cutover
audience: operator
status: living
owner: platform-eng
reviewed: 2026-07-06
binding: false
---

# CardCorp live cutover (ADR-0049)

Sequenced go-live for per-country CardCorp on `*.abbeygate.com`. Secrets are
operator-owned and never committed. Do steps in order; do not merge the code PR
before step 2.

## 1. DNS + TLS (must be green first)
- Point `cy|pt|gr.abbeygate.com` A/CNAME at the shared App Gateway public IP.
- Provision TLS for those hosts (cert-manager, or upload PFX and set repo var
  `CY4_AKS_APPGW_SSL_CERT_NAME`). Verify: `curl -I https://cy.abbeygate.com/health`.

## 2. Secrets (per namespace, BEFORE deploy)
Prod (`faciomga-prod`, live keys):
```bash
kubectl -n faciomga-prod patch secret abbeygate-runtime-secrets --type=merge -p '{"stringData":{
  "CARDCORP_ENV":"live",
  "CARDCORP_BEARER_TOKEN":"<shared live bearer>",
  "CARDCORP_ENTITY_ID_CY":"<cy entity>","CARDCORP_ENTITY_ID_PT":"<pt entity>","CARDCORP_ENTITY_ID_GR":"<gr entity>",
  "CARDCORP_WEBHOOK_SECRET_CY":"<cy 64-hex>","CARDCORP_WEBHOOK_SECRET_PT":"<pt 64-hex>","CARDCORP_WEBHOOK_SECRET_GR":"<gr 64-hex>"
}}'
```
Staging (`faciomga-staging`, test keys — all three point at the one test entity):
set `CARDCORP_ENV=test`, `CARDCORP_ENTITY_ID_{CY,PT,GR}=<test entity>`,
`CARDCORP_WEBHOOK_SECRET_{CY,PT,GR}=<test 64-hex>`, shared test bearer. The
`aby-367-provision-staging.sh` script writes these.

## 3. Deploy
Merge the ADR-0049 code PR to `main` (auto-deploys prod). Staging deploys via
`AKS Deploy (Staging)`. Confirm boot: `/health/integrations` shows `cardcorp`
and `sendgrid` = configured (not degraded).

## 4. Tenant public base URL (per env DB)
```sql
UPDATE "Tenant" SET "publicBaseUrl"='https://cy.abbeygate.com' WHERE "tenantSlug"='abbeygate-cy';
UPDATE "Tenant" SET "publicBaseUrl"='https://pt.abbeygate.com' WHERE "tenantSlug"='abbeygate-pt';
UPDATE "Tenant" SET "publicBaseUrl"='https://gr.abbeygate.com' WHERE "tenantSlug"='abbeygate-gr';
```
(Staging DB → the matching `*.staging.abbeygate.com`.)

## 5. Activate webhooks + verify
- Tell CardCorp to send the test notification per channel; endpoint must return
  200. Check the `WEBHOOK.CARDCORP.DECRYPTED` outbox event shows the right
  `channelCountry`.
- Run one live smoke payment per country; confirm the widget cannot receive
  input before `onReady`, then completes 3DS and sends the welcome email.

## 6. facio.io → staging (final, DNS-coordinated)
Only after prod is verified on `*.abbeygate.com`: repoint `abbeygate-*.facio.io`
DNS to staging, remove the four `facio.io` hosts from `values.yaml`, add them to
`values-staging.yaml`. Not before — it is destructive to live links.
