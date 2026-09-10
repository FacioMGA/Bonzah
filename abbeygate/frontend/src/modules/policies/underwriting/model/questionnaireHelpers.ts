import { asRecord } from '@/src/shared/lib/record';
import { EMAIL_REGEX } from '@facio/validation';
export type UnknownRecord = Record<string, unknown>;

export type AdditionalDriverDraft = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  licenseYears: string;
  email: string;
  telephone: string;
};

export function normalizeComparable(value: unknown): string | number | boolean {
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  const s = String(value ?? '').trim();
  if (s.toLowerCase() === 'true') return true;
  if (s.toLowerCase() === 'false') return false;
  const n = Number(s);
  if (s !== '' && Number.isFinite(n)) return n;
  return s;
}

export function normalizeAdditionalDrivers(value: unknown): AdditionalDriverDraft[] {
  const looksLikePhone = (raw: string) => {
    const s = String(raw || '').trim();
    const digits = s.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
  };
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .map((item) => {
      let email = String(item.email || '').trim();
      let telephone = String(item.telephone || '').trim();
      if (email && telephone && !EMAIL_REGEX.test(email) && EMAIL_REGEX.test(telephone) && looksLikePhone(email)) {
        const nextEmail = telephone;
        const nextTelephone = email;
        email = nextEmail;
        telephone = nextTelephone;
      }
      return {
        firstName: String(item.firstName || '').trim(),
        lastName: String(item.lastName || '').trim(),
        dateOfBirth: String(item.dateOfBirth || '').trim(),
        licenseYears: String(item.licenseYears ?? '').trim(),
        email,
        telephone,
      };
    });
}

export function clampE164Phone(v: string): string {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const prefixed = raw.startsWith('+') ? raw : `+${raw}`;
  const digits = prefixed.replace(/\D/g, '');
  if (!digits) return '';
  return `+${digits.slice(0, 15)}`;
}
