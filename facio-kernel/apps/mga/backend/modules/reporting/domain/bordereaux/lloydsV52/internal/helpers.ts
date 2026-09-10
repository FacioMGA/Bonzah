// Internal helpers shared across the Lloyd's CRS v5.2 modules.
// Not part of the public surface — do not re-export from `../lloydsV52.ts`.

type UnknownRecord = Record<string, unknown>;

export function asRecord(v: unknown): UnknownRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};
}

export function maybeRecord(v: unknown): UnknownRecord | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : undefined;
}

export function toISODate(d?: Date | string | null) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  const day = String(dt.getUTCDate()).padStart(2, '0');
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const year = String(dt.getUTCFullYear());
  return `${day}/${month}/${year}`;
}

export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

export function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function asDateEpoch(value: unknown): number | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    const ts = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(ts) ? null : ts;
  }
  const iso = Date.parse(raw);
  return Number.isNaN(iso) ? null : iso;
}
