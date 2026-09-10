import crypto from 'crypto';

function isPlainObject(x: unknown) {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x));
}

// Stable stringify: ensures deterministic hashes for snapshots/pricing integrity.
export function stableStringify(input: unknown): string {
  if (input === null || input === undefined) return 'null';
  if (typeof input === 'number' || typeof input === 'boolean') return String(input);
  if (typeof input === 'string') return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(stableStringify).join(',')}]`;
  if (isPlainObject(input)) {
    const keys = Object.keys(input).sort();
    const record = input as Record<string, unknown>;
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
  }
  // Dates / other objects: stringify best-effort
  return JSON.stringify(input);
}

export function sha256Hex(input: string | Buffer) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

