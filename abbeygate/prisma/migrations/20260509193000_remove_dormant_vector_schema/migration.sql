-- Remove dormant vector affordances that are not part of the production
-- behavior-intelligence spine.
--
-- The guards below prevent silent data loss if a non-code path populated the
-- old columns/table. In that case, stop and decide whether to migrate that
-- data into a real canonical owner instead of dropping it.

DO $$
BEGIN
    IF to_regclass('public.policy_vectors') IS NOT NULL
       AND EXISTS (SELECT 1 FROM "policy_vectors" LIMIT 1) THEN
        RAISE EXCEPTION 'Refusing to drop policy_vectors because it contains rows';
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.binder_clauses') IS NOT NULL
       AND EXISTS (SELECT 1 FROM "binder_clauses" WHERE "embedding" IS NOT NULL LIMIT 1) THEN
        RAISE EXCEPTION 'Refusing to drop binder_clauses.embedding because non-null embeddings exist';
    END IF;
END $$;

DROP INDEX IF EXISTS "policy_vectors_embedding_hnsw_cosine_idx";
DROP INDEX IF EXISTS "idx_policy_vectors_op_tenant";
DROP INDEX IF EXISTS "policy_vectors_operatingTenantId_idx";
DROP TABLE IF EXISTS "policy_vectors";

ALTER TABLE "binder_clauses" DROP COLUMN IF EXISTS "embedding";
