import type { CurrencyCode } from '@/src/shared/lib/format';
import { asRecord, type UnknownRecord } from '@/src/shared/lib/record';

export function asSnapshot(value: unknown): UnknownRecord {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return asRecord(value);
}

export function asCurrencyCode(input: unknown): CurrencyCode {
  const c = String(input || 'USD').toUpperCase();
  if (c === 'EUR' || c === 'GBP') return c;
  return 'USD';
}

export function isStartDateWithinWindow(isoDate: string): boolean {
  const d = new Date(String(isoDate || ''));
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const max = new Date(today);
  max.setDate(max.getDate() + 45);
  return d >= today && d <= max;
}
