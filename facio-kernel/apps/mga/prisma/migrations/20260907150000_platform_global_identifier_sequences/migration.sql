-- A global counter makes compact tenant prefixes collision-safe, even when
-- different tenants share the same country or first twelve slug characters.
-- Initialize numeric certificates above all retained rows under migration-owner
-- authority; runtime must never bypass tenant RLS to discover another policy.
BEGIN;
SET LOCAL row_security = off;
LOCK TABLE policy_number_sequences IN EXCLUSIVE MODE;
LOCK TABLE policies IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO policy_number_sequences (key, next)
SELECT 'PLATFORM:GLOBAL:' || kind,
  GREATEST(floor_value::bigint,
    COALESCE((SELECT MAX(next) FROM policy_number_sequences WHERE key LIKE '%:' || kind || ':%'), 0),
    CASE kind
      WHEN 'CERTIFICATE' THEN COALESCE((SELECT MAX("certificateNumber"::bigint) + 1 FROM policies WHERE "certificateNumber" ~ '^[0-9]+$'), 0)
      WHEN 'GREENCARD' THEN COALESCE((SELECT MAX("greenCardSerial"::bigint) + 1 FROM policies WHERE "greenCardSerial" ~ '^[0-9]+$'), 0)
      ELSE 0 END)::integer
FROM (VALUES ('POLICY', 5000001), ('QUOTE', 5000001), ('CERTIFICATE', 825000000), ('GREENCARD', 824000000)) AS seeds(kind, floor_value)
ON CONFLICT (key) DO UPDATE SET next = GREATEST(policy_number_sequences.next, EXCLUDED.next);
COMMIT;
