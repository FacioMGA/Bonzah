function parseIsoDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function annualTravelPolicyEndDateFromStart(startIso: string): string {
  const parts = parseIsoDateParts(startIso);
  if (!parts) return '';
  const end = new Date(Date.UTC(parts.year + 1, parts.month - 1, parts.day));
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

export function isTravelAnnualEndDateWithinOneYear(startIso: string, endIso: string): boolean {
  const expectedEnd = annualTravelPolicyEndDateFromStart(startIso);
  if (!expectedEnd) return true;
  const end = parseIsoDateParts(endIso);
  if (!end) return true;
  const endTime = Date.UTC(end.year, end.month - 1, end.day);
  const expectedTime = Date.parse(`${expectedEnd}T00:00:00.000Z`);
  return endTime <= expectedTime;
}
