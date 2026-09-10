/**
 * clientFnol.helpers — Pure utilities only
 *
 * No domain types — those live in clientFnol.types.ts
 * No validation — that lives in clientFnol.validation.ts
 * No model extraction — that lives in clientFnol.model.ts
 * No payload shaping — that lives in clientFnol.submit.ts
 *
 * Owns: date formatting, phone country mapping, phone input CSS, E.164 clamping, record coercion.
 */

type UnknownRecord = Record<string, unknown>;
const asRecord = (v: unknown): UnknownRecord =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : {};

export const toRecord = (v: unknown): UnknownRecord => asRecord(v);

export function isoDate(value: Date): string {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  const dd = String(value.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatFnolDateForDisplay(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}/${month}/${year}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const dd = String(parsed.getDate()).padStart(2, '0');
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const yyyy = String(parsed.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function toPhoneDefaultCountry(code: string): 'US' | 'GB' | 'CY' | 'PT' | 'ES' | undefined {
  switch (String(code || '').toUpperCase()) {
    case 'US': return 'US';
    case 'GB': return 'GB';
    case 'CY': return 'CY';
    case 'PT': return 'PT';
    case 'ES': return 'ES';
    default: return undefined;
  }
}

export function fnolPhoneInputClass(hasError: boolean): string {
  return `ui-input w-full text-[15px] ${hasError ? 'border-red-500/70 ring-4 ring-red-500/10' : 'group-hover:border-gray-300 group-hover:shadow-md'} [&_.PhoneInputInput]:bg-transparent [&_.PhoneInputInput]:outline-none [&_.PhoneInputInput]:flex-1 [&_.PhoneInputInput]:min-w-0 [&_.PhoneInputInput]:w-0 [&_.PhoneInputInput]:border-0 [&_.PhoneInputInput]:shadow-none [&_.PhoneInputInput]:ring-0 [&_.PhoneInputInput]:font-semibold [&_.PhoneInputInput]:text-slate-700 [&_.PhoneInputCountry]:mr-2 [&_.PhoneInputCountry]:shrink-0 [&_.PhoneInputCountrySelect]:bg-transparent [&_.PhoneInputCountrySelect]:border-0 [&_.PhoneInputCountrySelect]:shadow-none [&_.PhoneInputCountrySelect]:outline-none [&_.PhoneInputCountrySelect]:ring-0`;
}

export function clampE164Phone(v: string): string {
  const s = String(v || '').trim();
  if (!s) return '';
  const hasPlus = s.startsWith('+');
  const digits = s.replace(/\D/g, '').slice(0, 15);
  return hasPlus ? `+${digits}` : digits;
}

type NormalizedUploadItem = { name: string; url: string; filename?: string };

function asText(v: unknown): string {
  if (typeof v !== 'string') return '';
  const next = v.trim();
  return next && next !== '[object Object]' ? next : '';
}

export function normalizeFnolUploadItem(value: unknown): NormalizedUploadItem | null {
  if (typeof value === 'string') {
    const raw = asText(value);
    if (!raw) return null;
    const isLikelyUrl = /^(https?:\/\/|\/|blob:|data:)/i.test(raw);
    return isLikelyUrl
      ? { name: raw.split('/').pop() || 'file', url: raw }
      : { name: raw, url: '' };
  }
  const rec = asRecord(value);
  const fileRec = asRecord(rec.file);
  const docRec = asRecord(rec.document);
  const url =
    asText(rec.url) ||
    asText(rec.href) ||
    asText(rec.storageUri) ||
    asText(rec.publicUrl) ||
    asText(fileRec.url) ||
    asText(docRec.url);
  const filename =
    asText(rec.filename) ||
    asText(rec.originalName) ||
    asText(fileRec.filename) ||
    asText(fileRec.name) ||
    asText(docRec.filename) ||
    asText(docRec.name) ||
    undefined;
  const name =
    asText(rec.name) ||
    asText(rec.label) ||
    asText(fileRec.name) ||
    asText(docRec.name) ||
    filename ||
    (url ? (url.split('/').pop() || 'file') : '');
  if (!name && !url) return null;
  return { name, url, filename };
}

export function normalizeFnolUploadItems(value: unknown): NormalizedUploadItem[] {
  return (Array.isArray(value) ? value : [])
    .map(normalizeFnolUploadItem)
    .filter((item): item is NormalizedUploadItem => Boolean(item));
}

export function fnolUploadDisplayName(item: { name?: unknown; filename?: unknown; url?: unknown }): string {
  const name = asText(item.name);
  if (name) return name;
  const filename = asText(item.filename);
  if (filename) return filename;
  const url = asText(item.url);
  return url ? (url.split('/').pop() || 'file') : 'file';
}
