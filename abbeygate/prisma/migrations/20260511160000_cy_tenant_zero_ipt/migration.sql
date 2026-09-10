-- Cyprus binders (Home + Travel) carry no policy-level IPT. The legacy
-- Abbeygate schedules (NH82515223207-04-2026.pdf, doc_(1)1337598700.pdf)
-- both print `Local Taxes / Tax Fee = 0.00`. The CY tenant row was
-- seeded with `{flatFee: 2}` which leaked an incorrect €2 line onto
-- customer bills (reported by a customer on 2026-05-11).
--
-- Motor uses its own tax regime (MIF surcharge + stamp duty in
-- `motorTaxes.ts`) and never reads `tenants.ipt`, so this update is
-- safe for motor.

UPDATE "tenants"
SET "ipt" = '{"flatFee": 0}'::jsonb
WHERE "tenantSlug" = 'abbeygate-cy'
  AND (("ipt" ->> 'flatFee')::numeric IS DISTINCT FROM 0
       OR ("ipt" ->> 'flatFee') IS NULL);
