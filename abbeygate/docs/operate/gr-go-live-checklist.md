---
title: Greece (gr.abbeygate.com) go-live checklist
audience: operator
status: living
owner: platform-eng
reviewed: 2026-07-23
binding: false
---

# Greece go-live checklist

Bring `abbeygate-gr` live on `gr.abbeygate.com` at Cyprus product parity. Do the
in-repo prerequisites first, then the operator cutover. HEALTH is out of scope
(gated by [ADR-0053](../architecture/decisions/ADR-0053-health-greece-jurisdiction-gate.md)).

## A. In-repo prerequisites (shipped in the go-live PR)
- Jurisdiction configs for GR: MOTOR, HOME, TRAVEL, BUSINESS, OPEN_MARKET
  (`productConfiguration.ts`). HEALTH intentionally absent.
- Migration `20260723120000_seed_gr_business_open_market_manual_products` seeds
  the GR manual Business/Open Market program + binder authority. It MUST be
  applied to each target DB (`prisma migrate deploy`) or those wizards 503.
- CORS allows `gr.abbeygate.com` (+ staging) and `abbeygate-gr.facio.io`.

## B. Operator cutover (per env)
Follow [cardcorp-live-cutover.md](./cardcorp-live-cutover.md) — it already covers GR:
1. DNS + TLS for `gr.abbeygate.com` (wildcard cert already in Helm `abbeygateIngress`).
2. Secrets: `CARDCORP_ENTITY_ID_GR`, `CARDCORP_WEBHOOK_SECRET_GR`, `CARDCORP_ENV=live`.
3. Deploy; `/health/integrations` not degraded.
4. DB: `UPDATE "Tenant" SET "publicBaseUrl"='https://gr.abbeygate.com' WHERE "tenantSlug"='abbeygate-gr';`
5. Register + verify the CardCorp webhook for `gr.abbeygate.com`.

## C. Verify
- `curl -I https://gr.abbeygate.com/health` → 200 with expected `version`+`fix`.
- Public quote reachable per product: `/quote/{motor,home,travel,business,open-market}/new`.
- `npm run smoke:quote-bind-issue` against the GR host (quote → pay → issue → docs → email).
- Confirm `/quote/health/new` is NOT offered on GR (ADR-0053 gate).

## D. Optional data cutover
If migrating historical GR book, follow
[go-live-home-data-cutover.md](./go-live-home-data-cutover.md) (GR in scope).
