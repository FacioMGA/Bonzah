-- =====================================================================
-- Phase 2.5 — Canonical data cutover for TRAVEL product policies.
--
-- Purpose
--   Rewrite every TRAVEL `policies.quoteData` JSONB to use the canonical
--   nested `proposer.*` shape. Legacy drafts (and the now-deleted
--   `travelCanonicalShape` Zod preprocess) used to keep proposer details
--   at the root of `quoteData`:
--
--     { firstName, lastName, email, telephone, dateOfBirth, nationality,
--       nif, country, ... }
--
--   The canonical Travel shape is:
--
--     { proposer: { firstName, lastName, email, phone, dateOfBirth,
--                   nationality, nif, ... }, ... }
--
--   This migration:
--     1. Reads every Policy row with productType = 'TRAVEL' (case-
--        insensitive).
--     2. For each root-level legacy alias that is set and absent from
--        proposer, copies the value into the canonical nested location.
--        Field map (root → proposer):
--          firstName    → proposer.firstName
--          lastName     → proposer.lastName
--          email        → proposer.email
--          telephone    → proposer.phone        -- alias rename
--          dateOfBirth  → proposer.dateOfBirth
--          nationality  → proposer.nationality
--          nif          → proposer.nif
--          country      → proposer.domicileCountry
--     3. Strips every legacy root-level key listed above from quoteData.
--
-- Idempotency
--   Re-running this migration is a no-op for already-canonical data.
--   The `coalesce(... , root)` style ensures we never overwrite an
--   existing nested value with a stale root alias.
--
-- Backfill scope
--   Only TRAVEL policies. MOTOR uses root-level proposer fields by
--   design (its ValidationProfile reads `firstName`, `lastName`,
--   `email`, `telephone` directly), so we do not touch its rows. HOME
--   does not yet ship.
--
-- Safety
--   - Wrapped in a transaction so partial failure rolls back.
--   - Uses jsonb operators only; no plpgsql to avoid prepared-statement
--     issues with Prisma's migration runner.
-- =====================================================================

BEGIN;

UPDATE "policies" AS p
SET "quoteData" = (
  -- Step 1: build merged proposer object (existing nested wins over root alias).
  jsonb_set(
    -- Step 2: strip legacy root keys from quoteData first, so the nested
    -- proposer is the only carrier of those values after the migration.
    (
      COALESCE(p."quoteData", '{}'::jsonb)
        - 'firstName'
        - 'lastName'
        - 'email'
        - 'telephone'
        - 'dateOfBirth'
        - 'nationality'
        - 'nif'
        - 'country'
    ),
    '{proposer}',
    (
      jsonb_strip_nulls(
        COALESCE(p."quoteData" -> 'proposer', '{}'::jsonb)
        || jsonb_build_object(
          'firstName',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'firstName',
            p."quoteData" -> 'firstName'
          ),
          'lastName',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'lastName',
            p."quoteData" -> 'lastName'
          ),
          'email',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'email',
            p."quoteData" -> 'email'
          ),
          'phone',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'phone',
            p."quoteData" -> 'telephone'
          ),
          'dateOfBirth',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'dateOfBirth',
            p."quoteData" -> 'dateOfBirth'
          ),
          'nationality',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'nationality',
            p."quoteData" -> 'nationality'
          ),
          'nif',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'nif',
            p."quoteData" -> 'nif'
          ),
          'domicileCountry',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'domicileCountry',
            p."quoteData" -> 'country'
          )
        )
      )
    ),
    true
  )
)
WHERE
  -- Travel only.
  UPPER(COALESCE(p."productType", '')) = 'TRAVEL'
  AND p."quoteData" IS NOT NULL
  -- Skip rows that have no legacy root keys to lift (idempotent guard).
  AND (
       p."quoteData" ? 'firstName'
    OR p."quoteData" ? 'lastName'
    OR p."quoteData" ? 'email'
    OR p."quoteData" ? 'telephone'
    OR p."quoteData" ? 'dateOfBirth'
    OR p."quoteData" ? 'nationality'
    OR p."quoteData" ? 'nif'
    OR p."quoteData" ? 'country'
  );

COMMIT;
