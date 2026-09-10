-- ADR-0032 / ABY-280 — Seed HEALTH ProductDefinition and overlay
-- HEALTH BinderProductAuthority + ProgramBinderLink onto every active
-- BRIT TRAVEL binder per tenant, in production.
--
-- Why this migration exists
-- -------------------------
-- HEALTH (Brit Immigration Medical) is intentionally a binder OVERLAY
-- on the existing BRIT TRAVEL binder family — it does not have its own
-- BAA. The dev seed (`backend/seed/binders.ts`) does this overlay
-- correctly, but seeds do not run in production. The HOME and TRAVEL
-- ProductDefinitions got dedicated SQL migrations
-- (20260420120000_seed_home_travel_product_definitions); HEALTH did
-- not. Without these rows the `/api/public/health/session` route
-- returns 503 "No active binder linked for HEALTH in this tenant"
-- because `findLatestActiveBinderLinkForProduct` joins on
-- `BinderProductAuthority(productCode='HEALTH')` and finds zero rows
-- (live verification: GET /api/public/travel/session = 200, POST
-- /api/public/health/session = 503 on release 4b77c56c).
--
-- What this migration does
-- ------------------------
-- 1. Insert the canonical `product_definitions('HEALTH', ...)` row.
-- 2. For every tenant that already runs an ACTIVE TRAVEL program,
--    insert a HEALTH program (status ACTIVE, mirroring the wizard's
--    expectations) — only if one does not already exist for that
--    tenant.
-- 3. For every ACTIVE program_binder_link whose program is TRAVEL,
--    insert the matching HEALTH program_binder_link onto the same
--    binder — if it does not already exist.
-- 4. For every binder reachable via #3, insert
--    `binder_product_authorities(productCode='HEALTH',
--    classOfBusiness='A&H', riskCode='A2', territorialScope=['CY'])`
--    — if a row for that (binder, HEALTH) pair does not already exist.
--
-- All four steps are idempotent (`ON CONFLICT … DO NOTHING` plus
-- `WHERE NOT EXISTS` guards), so re-running this migration is a
-- no-op. Mirrors the dev seed pattern in
-- `backend/seed/binders.ts` exactly. No fallback datasets, no silent
-- "if HEALTH program is missing, just upsert MOTOR" branches.

-- ── Step 1: ProductDefinition ────────────────────────────────────────────
INSERT INTO "product_definitions" ("code", "displayName", "icon", "isActive", "updatedAt")
VALUES
  ('HEALTH', 'Immigration Medical Insurance', 'heart-pulse', true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- ── Step 2: HEALTH Program per tenant that already has an ACTIVE TRAVEL program ──
-- One HEALTH program per tenant. We pin a canonical name so BO Programs
-- list stays consistent with the dev seed. Idempotency: skip tenants
-- that already have any program with productType='HEALTH'.
INSERT INTO "programs" (
  "id",
  "operatingTenantId",
  "name",
  "status",
  "productType",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  t."id",
  'Abbeygate Immigration Medical',
  'ACTIVE',
  'HEALTH',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
WHERE EXISTS (
  SELECT 1
  FROM "programs" p_travel
  WHERE p_travel."operatingTenantId" = t."id"
    AND p_travel."productType" = 'TRAVEL'
    AND p_travel."status" = 'ACTIVE'
)
AND NOT EXISTS (
  SELECT 1
  FROM "programs" p_health
  WHERE p_health."operatingTenantId" = t."id"
    AND p_health."productType" = 'HEALTH'
);

-- ── Step 3: ProgramBinderLink HEALTH → every binder TRAVEL is linked to ──
-- HEALTH rides the BRIT travel binder family (same binderId, different
-- programId). For each ACTIVE program_binder_link whose program is
-- TRAVEL, mirror it under the HEALTH program for the same tenant.
-- Idempotency: skip pairs already present (the @@unique([programId, binderId])
-- composite key would block them anyway).
INSERT INTO "program_binder_links" (
  "id",
  "programId",
  "binderId",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  p_health."id",
  pbl_travel."binderId",
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "program_binder_links" pbl_travel
JOIN "programs" p_travel ON p_travel."id" = pbl_travel."programId"
JOIN "programs" p_health
  ON p_health."operatingTenantId" = p_travel."operatingTenantId"
  AND p_health."productType" = 'HEALTH'
WHERE p_travel."productType" = 'TRAVEL'
  AND pbl_travel."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM "program_binder_links" pbl_existing
    WHERE pbl_existing."programId" = p_health."id"
      AND pbl_existing."binderId" = pbl_travel."binderId"
  );

-- ── Step 4: BinderProductAuthority(productCode='HEALTH') on every binder ──
-- Lloyd's defaults per ADR-0032 §3 ("BinderProductAuthority(productCode='HEALTH',
-- classOfBusiness='A&H', riskCode='A2', territorialScope=['CY'])"). Phase 1
-- is CY-only; expanding territorialScope to PT/ES/GR is a separate ADR-0032
-- follow-up. Idempotency: skip (binderId, productCode='HEALTH') already
-- present (the table's composite unique key blocks them anyway).
INSERT INTO "binder_product_authorities" (
  "id",
  "operatingTenantId",
  "binderId",
  "productCode",
  "classOfBusiness",
  "riskCode",
  "territorialScope",
  "authorityClasses",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT
  gen_random_uuid(),
  b."operatingTenantId",
  b."id",
  'HEALTH',
  'A&H',
  'A2',
  ARRAY['CY']::text[],
  ARRAY[]::text[],
  CASE
    WHEN (b."startDate" IS NULL OR b."startDate" <= CURRENT_TIMESTAMP)
     AND (b."endDate" IS NULL OR b."endDate" >= CURRENT_TIMESTAMP)
    THEN 'ACTIVE'
    WHEN b."endDate" IS NOT NULL AND b."endDate" < CURRENT_TIMESTAMP
    THEN 'EXPIRED'
    ELSE 'PENDING'
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "binders" b
JOIN "program_binder_links" pbl ON pbl."binderId" = b."id"
JOIN "programs" p ON p."id" = pbl."programId"
WHERE p."productType" = 'TRAVEL'
  AND pbl."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM "binder_product_authorities" bpa
    WHERE bpa."binderId" = b."id"
      AND bpa."productCode" = 'HEALTH'
  );
