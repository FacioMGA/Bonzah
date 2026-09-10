/**
 * Canonical helper for narrowing an `unknown` to a `Record<string, unknown>`
 * at module / HTTP / persistence boundaries.
 *
 * Returns `{}` for anything that is not a plain object (null, primitives,
 * arrays). Callers that need to distinguish "missing" from "empty" should
 * check the input themselves before calling.
 *
 * This is the single canonical implementation per the canonical-ownership
 * contract; per-module copies are forbidden by `tools/quality/check-architecture-locks.mjs`.
 */
export type UnknownRecord = Record<string, unknown>;

export function parseRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : {};
}
