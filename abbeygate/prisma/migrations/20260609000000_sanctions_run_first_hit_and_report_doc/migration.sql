-- Sanctions screening: persist the top-hit projection (Match %, Name,
-- Country, DOB, Gender, PEP Tier, Reason Listed, Hit ID, hitIdsAll[])
-- and link the Creditsafe KYC Protect AML PDF report when one was fetched.
--
-- Decisions:
-- * `firstHitJson` is JSONB and nullable — only present when the run had at
--   least one hit. The shape is owned by `SanctionFirstHit` in
--   `backend/modules/compliance/domain/sanctionsTypes.ts`.
-- * `reportDocumentId` is a nullable FK to `documents`. Creditsafe charges
--   credits per PDF, and clean searches have no report worth storing, so
--   the column is null for `outcome = 'clear' | 'provider_unavailable' |
--   'error'` runs. ON DELETE SET NULL because retaining the screening run
--   audit row is more important than the PDF (the JSON response remains in
--   `responseJson`).
-- * No NOT NULL backfill needed — both columns default to NULL and existing
--   runs (history-only) are unaffected.

ALTER TABLE "sanction_screening_runs"
    ADD COLUMN "firstHitJson" JSONB,
    ADD COLUMN "reportDocumentId" TEXT;

ALTER TABLE "sanction_screening_runs"
    ADD CONSTRAINT "sanction_screening_runs_reportDocumentId_fkey"
    FOREIGN KEY ("reportDocumentId") REFERENCES "documents"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "sanction_screening_runs_reportDocumentId_idx"
    ON "sanction_screening_runs"("reportDocumentId");
