-- UMR correctness — correct the Motor binder Unique Market References.
--
-- Background
-- ----------
-- The Motor year-binders were seeded with an internal placeholder UMR
-- ('B6081 ABBEYGATE0125-YYYY') instead of the market UMR. The correct
-- references follow the same B17602{YY}EEA615x scheme as the Home (…6551)
-- and Travel (…6153) binders; Motor is …6152, confirmed by the coverholder
-- (Abbeygate). This migration corrects the binder rows and re-syncs any
-- already-issued Motor policy's mirrored `umr` to the binder value so a
-- document regeneration renders the correct reference.
--
-- After the accompanying code change, the UMR is sourced exclusively from
-- the binder at issuance (resolvePolicyUmrFromBinder). There is no code path
-- that can fabricate it from a policy/quote number or generate a placeholder.
--
-- Idempotent: each statement only rewrites rows that still hold a wrong
-- value (guarded by `WHERE umr <> …` / `IS DISTINCT FROM`).

-- ── 1. Correct the Motor binder UMRs (by canonical binder id) ─────────────
UPDATE "binders" SET "umr" = 'B176024EEA6152', "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = 'ABBEYGATE0125-BINDER-2024' AND "umr" <> 'B176024EEA6152';

UPDATE "binders" SET "umr" = 'B176025EEA6152', "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = 'ABBEYGATE0125-BINDER-2025' AND "umr" <> 'B176025EEA6152';

UPDATE "binders" SET "umr" = 'B176026EEA6152', "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = 'ABBEYGATE0125-BINDER-2026' AND "umr" <> 'B176026EEA6152';

-- ── 2. Re-sync mirrored policy UMR for policies on those binders ──────────
-- `policy.umr` is a mirror of the bound binder's UMR (set at issuance). Any
-- Motor policy already bound to these binders may carry the old placeholder
-- (or, from the pre-fix issuance bug, a policy number / generated value).
-- Realign it to the binder so a document regeneration renders the correct
-- reference. Only rows that differ are touched.
UPDATE "policies" p
   SET "umr" = b."umr", "updatedAt" = CURRENT_TIMESTAMP
  FROM "binders" b
 WHERE p."binderId" = b."id"
   AND b."id" IN (
     'ABBEYGATE0125-BINDER-2024',
     'ABBEYGATE0125-BINDER-2025',
     'ABBEYGATE0125-BINDER-2026'
   )
   AND p."umr" IS DISTINCT FROM b."umr";
