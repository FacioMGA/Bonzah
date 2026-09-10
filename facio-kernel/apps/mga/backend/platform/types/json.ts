/**
 * Canonical JSON value types for typed JSON columns and open metadata bags.
 *
 * Domain-importable: no `@prisma/client` coupling, so domain files may use
 * `JsonObject` for an open key/value bag instead of an untyped string-keyed
 * record (which the type-laundering guard rejects as a polite `any`) while
 * staying within `check-domain-purity` (only `platform/db/connection` and
 * `@prisma/client` are domain impurities).
 */

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}
