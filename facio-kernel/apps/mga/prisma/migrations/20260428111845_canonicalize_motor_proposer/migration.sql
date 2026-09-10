-- =====================================================================
-- Phase 6k — Canonical data cutover for MOTOR product policies.
--
-- Purpose
--   Rewrite every MOTOR `policies.quoteData` JSONB to use the canonical
--   nested `proposer.*` shape. Motor used to carry policyholder fields
--   at the root of `quoteData` (the dual-write/read helpers
--   `withPolicyholderAliases` (FE) and `withCanonicalPolicyholderAliases`
--   (BE) are deleted in this same change set):
--
--     { firstName, lastName, email, telephone, dateOfBirth, nationality,
--       nif, country, addressLine, city, province, postCode, occupation,
--       whereDidYouHear, marketingOptIn, privacyPolicyAccepted,
--       bestTimeToCall, ... }
--
--   The canonical Motor shape is:
--
--     { proposer: {
--         firstName, lastName, email, phone, dateOfBirth, nationality,
--         nif, domicileCountry, occupation, whereDidYouHear,
--         marketingConsent, privacyPolicyAccepted, bestTimeToCall,
--         address: { line1, city, province, postcode, country }
--       },
--       ...
--     }
--
--   This migration:
--     1. Reads every Policy row with productType = 'MOTOR' (case-
--        insensitive).
--     2. For each root-level legacy alias that is set and absent from
--        proposer, copies the value into the canonical nested location.
--        Field map (root → proposer):
--          firstName            → proposer.firstName
--          lastName             → proposer.lastName
--          email                → proposer.email
--          telephone            → proposer.phone               (alias rename)
--          dateOfBirth          → proposer.dateOfBirth
--          nationality          → proposer.nationality
--          nif                  → proposer.nif
--          country              → proposer.domicileCountry     (alias rename)
--          addressLine          → proposer.address.line1
--          city                 → proposer.address.city
--          province             → proposer.address.province
--          postCode             → proposer.address.postcode
--          occupation           → proposer.occupation
--          whereDidYouHear      → proposer.whereDidYouHear
--          marketingOptIn       → proposer.marketingConsent    (alias rename)
--          privacyPolicyAccepted→ proposer.privacyPolicyAccepted
--          bestTimeToCall       → proposer.bestTimeToCall
--     3. Strips every legacy root-level key listed above from quoteData.
--
-- Idempotency
--   Re-running this migration is a no-op for already-canonical data.
--   The `coalesce(... , root)` style ensures we never overwrite an
--   existing nested value with a stale root alias.
--
-- Backfill scope
--   Only MOTOR policies. TRAVEL has already been canonicalised by
--   `20260427153132_canonicalize_travel_proposer`; HOME ships nested
--   from day one. Quotes whose `productType` is null are skipped
--   defensively.
--
-- Safety
--   - Wrapped in a transaction so partial failure rolls back.
--   - Uses jsonb operators only; no plpgsql to avoid prepared-statement
--     issues with Prisma's migration runner.
--   - The `proposer.address` sub-object is built only if at least one
--     of the four address keys is set on root, otherwise it is left
--     untouched (preserving any pre-existing nested address).
-- =====================================================================

BEGIN;

UPDATE "policies" AS p
SET "quoteData" = (
  -- Step 1: build merged proposer object (existing nested wins over
  -- root alias). The address sub-object is rebuilt with the same
  -- coalesce(nested, root) logic.
  jsonb_set(
    -- Step 2: strip legacy root keys from quoteData first, so the
    -- nested proposer is the only carrier of those values after the
    -- migration.
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
        - 'addressLine'
        - 'city'
        - 'province'
        - 'postCode'
        - 'occupation'
        - 'whereDidYouHear'
        - 'marketingOptIn'
        - 'privacyPolicyAccepted'
        - 'bestTimeToCall'
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
          ),
          'occupation',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'occupation',
            p."quoteData" -> 'occupation'
          ),
          'whereDidYouHear',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'whereDidYouHear',
            p."quoteData" -> 'whereDidYouHear'
          ),
          'marketingConsent',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'marketingConsent',
            p."quoteData" -> 'marketingOptIn'
          ),
          'privacyPolicyAccepted',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'privacyPolicyAccepted',
            p."quoteData" -> 'privacyPolicyAccepted'
          ),
          'bestTimeToCall',
          COALESCE(
            p."quoteData" -> 'proposer' -> 'bestTimeToCall',
            p."quoteData" -> 'bestTimeToCall'
          ),
          'address',
          jsonb_strip_nulls(
            COALESCE(p."quoteData" -> 'proposer' -> 'address', '{}'::jsonb)
            || jsonb_build_object(
              'line1',
              COALESCE(
                p."quoteData" -> 'proposer' -> 'address' -> 'line1',
                p."quoteData" -> 'addressLine'
              ),
              'city',
              COALESCE(
                p."quoteData" -> 'proposer' -> 'address' -> 'city',
                p."quoteData" -> 'city'
              ),
              'province',
              COALESCE(
                p."quoteData" -> 'proposer' -> 'address' -> 'province',
                p."quoteData" -> 'province'
              ),
              'postcode',
              COALESCE(
                p."quoteData" -> 'proposer' -> 'address' -> 'postcode',
                p."quoteData" -> 'postCode'
              ),
              'country',
              COALESCE(
                p."quoteData" -> 'proposer' -> 'address' -> 'country',
                p."quoteData" -> 'country'
              )
            )
          )
        )
      )
    ),
    true
  )
)
WHERE
  -- Motor only.
  UPPER(COALESCE(p."productType", '')) = 'MOTOR'
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
    OR p."quoteData" ? 'addressLine'
    OR p."quoteData" ? 'city'
    OR p."quoteData" ? 'province'
    OR p."quoteData" ? 'postCode'
    OR p."quoteData" ? 'occupation'
    OR p."quoteData" ? 'whereDidYouHear'
    OR p."quoteData" ? 'marketingOptIn'
    OR p."quoteData" ? 'privacyPolicyAccepted'
    OR p."quoteData" ? 'bestTimeToCall'
  );

COMMIT;
