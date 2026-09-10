/**
 * Shared wizard error utilities.
 *
 * Used by all product wizards (Travel, Motor, Home, …) to:
 *   - Traverse RHF's nested error object by dot-notation path
 *     (`getNestedError`).
 *   - Flatten `formState.errors` into a deduplicated `{ field, message }[]`
 *     that feeds `QuoteWizardErrorSummary` (`collectErrorEntries` +
 *     `dedupeErrorEntries`).
 *
 * This is the single source of truth — no product may add a local copy.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorEntry {
  field: string;
  message: string;
}

// ---------------------------------------------------------------------------
// getNestedError
// ---------------------------------------------------------------------------

/**
 * Traverse a potentially nested RHF `formState.errors` object using a
 * dot-separated path (e.g. `"eligibility.countryOfResidence"`) and return
 * the first string `message` found at that location, or `undefined`.
 */
export function getNestedError(
  errors: Record<string, unknown>,
  path: string,
): string | undefined {
  const parts = path.split('.');
  let current: unknown = errors;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === 'string') return current;
  if (current && typeof current === 'object') {
    const msg = (current as Record<string, unknown>).message;
    return typeof msg === 'string' ? msg : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// collectErrorEntries
// ---------------------------------------------------------------------------

/**
 * Recursively walk an RHF `formState.errors` node and collect every
 * `{ field, message }` pair found. The `path` argument tracks the
 * dot-separated key sequence from the root.
 */
export function collectErrorEntries(
  node: unknown,
  path = '',
): ErrorEntry[] {
  if (!node || typeof node !== 'object') return [];
  const rec = node as Record<string, unknown>;
  const entries: ErrorEntry[] = [];

  const message = rec.message;
  if (typeof message === 'string' && message.trim()) {
    entries.push({ field: path || 'form', message });
  }

  for (const [key, value] of Object.entries(rec)) {
    if (key === 'message' || key === 'type' || key === 'ref') continue;
    const nextPath = path ? `${path}.${key}` : key;
    entries.push(...collectErrorEntries(value, nextPath));
  }

  return entries;
}

// ---------------------------------------------------------------------------
// dedupeErrorEntries
// ---------------------------------------------------------------------------

/**
 * Remove exact `field::message` duplicates from an `ErrorEntry[]`.
 * Order is preserved; only the first occurrence of each pair is kept.
 */
export function dedupeErrorEntries(entries: ErrorEntry[]): ErrorEntry[] {
  const seen = new Set<string>();
  const out: ErrorEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.field}::${entry.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}
