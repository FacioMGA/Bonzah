-- SyntheticEmailRun: delivery correlation (messageId), tenant scoping
-- (operatingTenantId), cleanup detail, and updatedAt. Additive only.
ALTER TABLE "synthetic_email_runs"
  ADD COLUMN "messageId" TEXT,
  ADD COLUMN "operatingTenantId" TEXT,
  ADD COLUMN "cleanupDetail" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "synthetic_email_runs_messageId_idx" ON "synthetic_email_runs"("messageId");
CREATE INDEX "synthetic_email_runs_operatingTenantId_idx" ON "synthetic_email_runs"("operatingTenantId");

-- Template approval invalidation (ADR-0068). Editing an APPROVED template's
-- rendered content (subject/body) must atomically drop it back to DRAFT, clear
-- the approver metadata, and bump the version — so the approval gate in
-- fetchTemplateOverride() can never keep serving unreviewed content. Enforced
-- in the database so ANY writer (BO, seed script, manual SQL) is covered, not
-- just a single application code path.
--
-- An explicit re-approval performed in the SAME write (approvedAt advanced) is
-- respected: the canonical seed upsert re-stamps approvedAt when it ships the
-- shipped design, so it is NOT auto-reset.
CREATE OR REPLACE FUNCTION reset_communication_template_approval()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW."subjectTemplate" IS DISTINCT FROM OLD."subjectTemplate"
      OR NEW."bodyTemplate" IS DISTINCT FROM OLD."bodyTemplate") THEN
    IF (NEW."approvedAt" IS NOT DISTINCT FROM OLD."approvedAt") THEN
      NEW."approvalStatus" := 'DRAFT';
      NEW."approvedBy" := NULL;
      NEW."approvedAt" := NULL;
      NEW."version" := COALESCE(OLD."version", 1) + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reset_communication_template_approval ON "communication_templates";
CREATE TRIGGER trg_reset_communication_template_approval
BEFORE UPDATE ON "communication_templates"
FOR EACH ROW
EXECUTE FUNCTION reset_communication_template_approval();
