-- Customer document binary access resolves current documents by tenant-scoped storage URI.
CREATE INDEX "documents_operatingTenantId_storageUri_status_idx"
ON "documents"("operatingTenantId", "storageUri", "status");
