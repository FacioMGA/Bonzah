/**
 * record.ts — Canonical record utilities.
 *
 * Shared across the entire frontend codebase.
 * Import from `@/src/shared/lib/record` instead of defining local copies.
 */

/** A plain JSON-like object with unknown values. */
export type UnknownRecord = Record<string, unknown>;

/**
 * Safely narrow an unknown value to a plain record.
 * Returns `{}` for null, undefined, arrays, and primitives.
 */
export function asRecord(value: unknown): UnknownRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as UnknownRecord)
        : {};
}

/**
 * Read a dot-separated path from a nested object.
 * Returns `undefined` if any segment is missing.
 *
 * Example: `getByPath({ a: { b: 1 } }, 'a.b')` => `1`
 */
export function getByPath(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>(
        (current, key) =>
            current && typeof current === 'object'
                ? (current as UnknownRecord)[key]
                : undefined,
        obj,
    );
}
