export function normalizePhone(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const hasLeadingPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/\D/g, '');
  return `${hasLeadingPlus ? '+' : ''}${digitsOnly}`;
}

export function clampE164Phone(value: string): string {
  const normalized = normalizePhone(value);
  if (!normalized) return '';
  const hasLeadingPlus = normalized.startsWith('+');
  const digitsOnly = normalized.replace(/\D/g, '').slice(0, 15);
  return `${hasLeadingPlus ? '+' : ''}${digitsOnly}`;
}

export function isValidPhone(value: string): boolean {
  const normalized = normalizePhone(value);
  if (!normalized) return true;
  return /^\+?[1-9]\d{6,14}$/.test(normalized);
}
