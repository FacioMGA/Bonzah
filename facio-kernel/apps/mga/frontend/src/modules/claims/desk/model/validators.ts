import { isValidPhone, normalizePhone } from '@/src/shared/lib/phone';
import type { CreateCaseDraft } from './types';

export function isValidEmail(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

export { isValidPhone, normalizePhone };

export function isValidIsoDate(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const dt = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.toISOString().slice(0, 10) === text;
}

export function isPastOrTodayIsoDate(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return true;
  if (!isValidIsoDate(text)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return text <= today;
}

export function clampTextLength(value: string, maxChars: number): string {
  const text = String(value || '');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export function getCreateDraftErrors(draft: CreateCaseDraft): { contactEmail: string; contactPhone: string; dateOfLoss: string } {
  return {
    contactEmail: isValidEmail(draft.contactEmail) ? '' : 'Enter a valid email address.',
    contactPhone: isValidPhone(draft.contactPhone) ? '' : 'Enter a valid phone number.',
    dateOfLoss: isPastOrTodayIsoDate(draft.dateOfLoss) ? '' : 'Enter a valid date (today or earlier).',
  };
}

