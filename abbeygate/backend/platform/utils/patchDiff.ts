/**
 * patchDiff — structural diff of two flat/nested plain-object snapshots.
 *
 * Returns flattened dot-notation KEY NAMES only — no values — so the output is
 * safe to log without leaking PII (name, DOB, address, etc.).
 *
 * Used by the public quote PATCH handlers to log what changed on each save,
 * enabling diagnosis of stale-data and partial-save bugs without querying the DB.
 */

type Rec = Record<string, unknown>;

function flattenKeys(obj: unknown, prefix = ''): Set<string> {
  const keys = new Set<string>();
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) keys.add(prefix);
    return keys;
  }
  const record = obj as Rec;
  for (const k of Object.keys(record)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const child = record[k];
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      for (const nested of flattenKeys(child, path)) keys.add(nested);
    } else {
      keys.add(path);
    }
  }
  return keys;
}

function stableString(v: unknown): string {
  try {
    return JSON.stringify(v, Object.keys(v as Rec | object).sort());
  } catch {
    return String(v);
  }
}

export function patchDiff(
  prev: Rec,
  next: Rec,
): { addedKeys: string[]; changedKeys: string[]; removedKeys: string[] } {
  const prevKeys = flattenKeys(prev);
  const nextKeys = flattenKeys(next);

  const addedKeys: string[] = [];
  const changedKeys: string[] = [];
  const removedKeys: string[] = [];

  for (const key of nextKeys) {
    if (!prevKeys.has(key)) {
      addedKeys.push(key);
    } else {
      const segments = key.split('.');
      const getAt = (obj: unknown, parts: string[]): unknown =>
        parts.reduce((acc, p) => (acc !== null && typeof acc === 'object' ? (acc as Rec)[p] : undefined), obj);
      const prevVal = getAt(prev, segments);
      const nextVal = getAt(next, segments);
      if (stableString(prevVal) !== stableString(nextVal)) changedKeys.push(key);
    }
  }

  for (const key of prevKeys) {
    if (!nextKeys.has(key)) removedKeys.push(key);
  }

  return { addedKeys, changedKeys, removedKeys };
}
