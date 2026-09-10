---
title: Quote-health canary
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-10
binding: false
---

# Quote-health canary

Answers one question on a schedule: **can a customer get a price right now?**
Rationale and the two-layer design are in
[ADR-0066](../architecture/decisions/ADR-0066-quote-health-self-monitoring.md).

## What runs

- Script: `tools/quality/ops/prove-quote-health.ts`.
- CronJob: `abbeygate-quote-health`, `*/5 * * * *` (Helm `quoteHealth`).
- It prices a golden-fixture application through the product engine for each
  product in `QUOTE_HEALTH_PRODUCTS` (default `MOTOR,HOME,TRAVEL`). No
  Creditsafe call — it is credit-free.
- On any product failing to price, it emails `QUOTE_HEALTH_ALERT_TO`
  (falls back to `ISSUANCE_PROOF_ALERT_TO`) and exits non-zero.

## Two layers (do not conflate)

- This canary catches ENGINE/config breakage (pricing stops working).
- The sanctions fail-closed spike (`sentry-alerts.md` rule 6) catches the
  COMPLIANCE-GATE outage from real traffic. Both must stay on.

## When it alerts

1. Confirm scope: check the failed CronJob logs
   (`kubectl -n faciomga-prod logs job/<abbeygate-quote-health-...>`); the log
   lists `PRODUCT=OK|FAIL` and the error per product.
2. Reproduce locally: `QUOTE_HEALTH_PRODUCTS=TRAVEL tsx tools/quality/ops/prove-quote-health.ts`.
3. If ALL products fail, suspect a shared cause (product registry, tenant
   config, rating data). If ONE fails, suspect that product's profile/rating.
4. Fix forward; do not silence the canary. To pause during a known migration,
   set `quoteHealth.enabled=false` and re-enable immediately after.

## Ad-hoc run

```
kubectl -n faciomga-prod create job --from=cronjob/abbeygate-quote-health quote-health-adhoc
```

## Related

- Fail-closed screening: `../architecture/decisions/ADR-0043-sanctions-screening-canonical-spine.md`
- Alert rules: `sentry-alerts.md` · Monitoring overview: `monitoring.md`
