-- Peter Sheppard BO transition baseline: simple people / HR records.

CREATE TABLE "personnel_files" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffNumber" TEXT,
    "jobTitle" TEXT,
    "office" TEXT,
    "phone" TEXT,
    "emergencyContact" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "personnel_files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "personnel_files_operatingTenantId_userId_key" ON "personnel_files"("operatingTenantId", "userId");
CREATE INDEX "personnel_files_operatingTenantId_idx" ON "personnel_files"("operatingTenantId");
CREATE INDEX "personnel_files_userId_idx" ON "personnel_files"("userId");
ALTER TABLE "personnel_files" ADD CONSTRAINT "personnel_files_operatingTenantId_fkey" FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE personnel_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON personnel_files USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE personnel_files FORCE ROW LEVEL SECURITY;

CREATE TABLE "staff_absences" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "absenceType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "staff_absences_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_absences_operatingTenantId_startDate_endDate_idx" ON "staff_absences"("operatingTenantId", "startDate", "endDate");
CREATE INDEX "staff_absences_operatingTenantId_userId_status_idx" ON "staff_absences"("operatingTenantId", "userId", "status");
ALTER TABLE "staff_absences" ADD CONSTRAINT "staff_absences_operatingTenantId_fkey" FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE staff_absences ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON staff_absences USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE staff_absences FORCE ROW LEVEL SECURITY;

CREATE TABLE "staff_payslips" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "personnelFileId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT,
    "uploadedByUserId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_payslips_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_payslips_operatingTenantId_personnelFileId_idx" ON "staff_payslips"("operatingTenantId", "personnelFileId");
CREATE INDEX "staff_payslips_uploadedAt_idx" ON "staff_payslips"("uploadedAt");
ALTER TABLE "staff_payslips" ADD CONSTRAINT "staff_payslips_operatingTenantId_fkey" FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_payslips" ADD CONSTRAINT "staff_payslips_personnelFileId_fkey" FOREIGN KEY ("personnelFileId") REFERENCES "personnel_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE staff_payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON staff_payslips USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE staff_payslips FORCE ROW LEVEL SECURITY;

CREATE TABLE "staff_diary_entries" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "visibility" TEXT NOT NULL DEFAULT 'STAFF',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "staff_diary_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_diary_entries_operatingTenantId_ownerUserId_startAt_idx" ON "staff_diary_entries"("operatingTenantId", "ownerUserId", "startAt");
CREATE INDEX "staff_diary_entries_operatingTenantId_startAt_idx" ON "staff_diary_entries"("operatingTenantId", "startAt");
ALTER TABLE "staff_diary_entries" ADD CONSTRAINT "staff_diary_entries_operatingTenantId_fkey" FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE staff_diary_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON staff_diary_entries USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE staff_diary_entries FORCE ROW LEVEL SECURITY;

CREATE TABLE "staff_messages" (
    "id" TEXT NOT NULL,
    "operatingTenantId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserIds" TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "archivedByUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_messages_operatingTenantId_fromUserId_createdAt_idx" ON "staff_messages"("operatingTenantId", "fromUserId", "createdAt");
CREATE INDEX "staff_messages_createdAt_idx" ON "staff_messages"("createdAt");
ALTER TABLE "staff_messages" ADD CONSTRAINT "staff_messages_operatingTenantId_fkey" FOREIGN KEY ("operatingTenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE staff_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY op_tenant_isolation ON staff_messages USING ("operatingTenantId" = current_setting('app.operating_tenant_id', true));
ALTER TABLE staff_messages FORCE ROW LEVEL SECURITY;
