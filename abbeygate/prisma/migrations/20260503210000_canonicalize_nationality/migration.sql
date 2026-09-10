-- =====================================================================
-- Validation PR — canonicalise stored nationality values.
--
-- Purpose
--   Migrate every persisted demonym (`'British'`, `'Cypriot'`,
--   `'Portuguese'`, `'Spanish'`, `'Greek'`) to its canonical country-name
--   counterpart so that the new `nationality` validation rule (which
--   requires membership in `NATIONALITY_OPTIONS`) does not reject
--   pre-existing rows.
--
--   Canonical contract:
--     packages/validation/src/nationality/contract.ts
--   ADR:
--     docs/architecture/decisions/ADR-0010-documentation-is-enforced.md
--   Guard:
--     tools/quality/check-contracts-product-consistency.mjs
--
-- Demonym → canonical country name map (matches
-- NATIONALITY_DEMONYM_TO_COUNTRY in the contract — keep in sync):
--   'British'    → 'United Kingdom'
--   'Cypriot'    → 'Cyprus'
--   'Greek'      → 'Greece'
--   'Portuguese' → 'Portugal'
--   'Spanish'    → 'Spain'
--
-- Scope
--   1. tenants.defaultNationality column (Prisma model `Tenant`,
--      mapped to physical table `tenants` via @@map).
--   2. policies.quoteData JSONB (Prisma model `Policy`,
--      mapped to physical table `policies` via @@map):
--        - top-level `nationality` (legacy flat shape)
--        - `proposer.nationality` (canonical shape, used by every product)
--   3. policy_quote_history.quoteData JSONB
--      (Prisma model `PolicyQuoteHistory`, mapped to
--      `policy_quote_history`) — same two paths. Wrapped in a
--      `EXCEPTION WHEN undefined_table` block because some legacy
--      schema variants do not contain this archive table yet.
--
-- Idempotency
--   Each statement is `WHERE current = legacy`, so re-running the
--   migration is a no-op for already-canonical data.
--
-- Reversibility
--   Forward-only. Storing demonyms is forbidden going forward; the
--   consistency guard fails CI on any new demonym default. Restoring
--   demonyms would require explicitly amending the contract first.
-- =====================================================================

-- 1. tenants.defaultNationality
UPDATE "tenants" SET "defaultNationality" = 'United Kingdom' WHERE "defaultNationality" = 'British';
UPDATE "tenants" SET "defaultNationality" = 'Cyprus'         WHERE "defaultNationality" = 'Cypriot';
UPDATE "tenants" SET "defaultNationality" = 'Greece'         WHERE "defaultNationality" = 'Greek';
UPDATE "tenants" SET "defaultNationality" = 'Portugal'       WHERE "defaultNationality" = 'Portuguese';
UPDATE "tenants" SET "defaultNationality" = 'Spain'          WHERE "defaultNationality" = 'Spanish';

-- 2. policies.quoteData.proposer.nationality (canonical) and 3. policy_quote_history (archive)
DO $$
DECLARE
  legacy TEXT;
  canonical TEXT;
  pair TEXT[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['British',    'United Kingdom'],
    ARRAY['Cypriot',    'Cyprus'],
    ARRAY['Greek',      'Greece'],
    ARRAY['Portuguese', 'Portugal'],
    ARRAY['Spanish',    'Spain']
  ] LOOP
    legacy := pair[1];
    canonical := pair[2];

    -- Canonical nested path
    UPDATE "policies"
    SET "quoteData" = jsonb_set(
      "quoteData",
      '{proposer,nationality}',
      to_jsonb(canonical),
      true
    )
    WHERE "quoteData" -> 'proposer' ->> 'nationality' = legacy;

    -- Legacy flat path
    UPDATE "policies"
    SET "quoteData" = jsonb_set(
      "quoteData",
      '{nationality}',
      to_jsonb(canonical),
      true
    )
    WHERE "quoteData" ->> 'nationality' = legacy;

    -- policy_quote_history.quoteData (same two paths, if table exists)
    BEGIN
      EXECUTE format(
        'UPDATE "policy_quote_history" SET "quoteData" = jsonb_set("quoteData", ''{proposer,nationality}'', to_jsonb(%L::text), true) WHERE "quoteData" -> ''proposer'' ->> ''nationality'' = %L',
        canonical, legacy
      );
      EXECUTE format(
        'UPDATE "policy_quote_history" SET "quoteData" = jsonb_set("quoteData", ''{nationality}'', to_jsonb(%L::text), true) WHERE "quoteData" ->> ''nationality'' = %L',
        canonical, legacy
      );
    EXCEPTION WHEN undefined_table THEN
      -- The policy_quote_history table is not present in every schema variant. Skip.
      NULL;
    END;
  END LOOP;
END
$$;
