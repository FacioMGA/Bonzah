export type CurrencyCode = 'USD' | 'GBP' | 'EUR';

export function formatCompanyName(name: string): string {
  if (!name) return name;
  // Normalize “HoboHome,LLC” -> “HoboHome, LLC” (and similar suffixes)
  return name
    .replace(/\s+/g, ' ')
    .replace(/,\s*(LLC|LTD|LIMITED|INC|CORP|LP|LLP|PLLC)\b/gi, ', $1')
    .trim();
}

export function parseDateUI(input: unknown): Date | null {
  if (!input) return null;
  if (input instanceof Date && !isNaN(input.getTime())) return input;

  if (typeof input === 'number') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof input === 'string') {
    // ISO-ish or native parseable
    const iso = new Date(input);
    if (!isNaN(iso.getTime())) return iso;

    // DD/MM/YYYY or MM/DD/YYYY (disambiguate: prefer US MM/DD when ambiguous)
    const m = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const yyyy = Number(m[3]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(yyyy)) return null;

      // Disambiguate:
      // - If a > 12 => DD/MM/YYYY
      // - Else if b > 12 => MM/DD/YYYY
      // - Else ambiguous => MM/DD/YYYY (US)
      let month = a;
      let day = b;
      if (a > 12 && b <= 12) {
        day = a;
        month = b;
      } else if (b > 12 && a <= 12) {
        month = a;
        day = b;
      } else if (a > 12 && b > 12) {
        return null;
      }

      const d = new Date(Date.UTC(yyyy, month - 1, day));
      return isNaN(d.getTime()) ? null : d;
    }
  }

  return null;
}

export function formatDateUI(input: unknown, opts?: { withTime?: boolean }): string {
  const d = parseDateUI(input);
  if (!d) return '—';

  const datePart = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(d);

  if (!opts?.withTime) return datePart;

  const timePart = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);

  return `${datePart}, ${timePart}`;
}

export function formatDateRangeUI(start: unknown, end: unknown): string {
  const s = formatDateUI(start);
  const e = formatDateUI(end);
  if (s === '—' && e === '—') return '—';
  return `${s} — ${e}`;
}

export function formatDateInputValueLocal(input: unknown): string {
  const d = parseDateUI(input);
  if (!d) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatMoneyUI(
  amount: unknown,
  currency: CurrencyCode = 'USD',
  opts?: { showCode?: boolean }
): string {
  const n = typeof amount === 'string' ? Number(amount) : (amount as number);
  const safe = Number.isFinite(n) ? n : 0;

  const symbol =
    currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';

  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(safe);

  return opts?.showCode ? `${symbol}${formatted} (${currency})` : `${symbol}${formatted}`;
}

