-- Seed HOME and TRAVEL ProductDefinitions
INSERT INTO "product_definitions" ("code", "displayName", "icon", "isActive", "updatedAt")
VALUES
  ('HOME', 'Home Insurance', 'home', true, CURRENT_TIMESTAMP),
  ('TRAVEL', 'Travel Insurance', 'plane', true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
