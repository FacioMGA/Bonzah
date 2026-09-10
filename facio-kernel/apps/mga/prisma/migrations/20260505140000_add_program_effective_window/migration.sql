-- Add lifecycle window columns to Program. Used by
-- evaluateIssueReadiness to block issuance when a policy's
-- inceptionDate falls outside the program's [effectiveFrom,
-- effectiveTo] window. Both columns are nullable so existing rows
-- remain unconstrained on either side.
ALTER TABLE "programs" ADD COLUMN "effectiveFrom" TIMESTAMP(3);
ALTER TABLE "programs" ADD COLUMN "effectiveTo"   TIMESTAMP(3);
