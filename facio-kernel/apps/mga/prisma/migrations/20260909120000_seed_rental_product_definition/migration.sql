-- Bonzah / RENTAL product catalogue registration.
--
-- The runtime, public journey, rating adapter, worker and document pack are
-- deployed from source, but programme and binder-authority configuration read
-- their selectable product codes from product_definitions.  Keep this migration
-- deliberately catalogue-only: tenant-specific programme configuration and
-- insurance authority must be created through the governed configuration flow.

INSERT INTO "product_definitions" ("code", "displayName", "icon", "isActive", "updatedAt")
VALUES
  ('RENTAL', 'Rental Vehicle Protection', 'car-front', true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET
  "displayName" = EXCLUDED."displayName",
  "icon" = EXCLUDED."icon",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
