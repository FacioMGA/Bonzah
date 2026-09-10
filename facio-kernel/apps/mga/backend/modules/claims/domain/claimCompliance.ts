type ProjectionLike = {
  status?: string;
  cr0107Denial?: string;
  deniedAt?: string | null;
  closedAt?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => asRecord(acc)[segment], source);
}

function normalizeCountryToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s._-]+/g, ' ')
    .replace(/[()]/g, '');
}

const EU_COUNTRY_TOKENS = new Set([
  'at', 'austria',
  'be', 'belgium',
  'bg', 'bulgaria',
  'hr', 'croatia',
  'cy', 'cyprus',
  'cz', 'czech republic', 'czechia',
  'dk', 'denmark',
  'ee', 'estonia',
  'fi', 'finland',
  'fr', 'france',
  'de', 'germany',
  'gr', 'greece',
  'hu', 'hungary',
  'ie', 'ireland',
  'it', 'italy',
  'lv', 'latvia',
  'lt', 'lithuania',
  'lu', 'luxembourg',
  'mt', 'malta',
  'nl', 'netherlands',
  'pl', 'poland',
  'pt', 'portugal',
  'ro', 'romania',
  'sk', 'slovakia',
  'si', 'slovenia',
  'es', 'spain',
  'se', 'sweden',
]);

export function isEuCountry(value: string): boolean {
  const token = normalizeCountryToken(value);
  if (EU_COUNTRY_TOKENS.has(token)) return true;
  const aliases: Record<string, string> = {
    usa: 'united states',
    us: 'united states',
    'u s': 'united states',
    'u.s': 'united states',
    'u.s.': 'united states',
    uk: 'united kingdom',
    'u k': 'united kingdom',
    'u.k': 'united kingdom',
    'u.k.': 'united kingdom',
    england: 'united kingdom',
    scotland: 'united kingdom',
    wales: 'united kingdom',
    'n ireland': 'united kingdom',
    'northern ireland': 'united kingdom',
    emirates: 'united arab emirates',
    uae: 'united arab emirates',
  };
  const canonical = aliases[token] || token;
  return EU_COUNTRY_TOKENS.has(canonical);
}

export function resolveLossCountry(claimData: Record<string, unknown>, fnolSnapshot: Record<string, unknown>): string {
  const candidates = [
    claimData.cr0116_loss_country,
    readPath(fnolSnapshot, 'incident.location.country'),
    readPath(fnolSnapshot, 'incident.country'),
    readPath(fnolSnapshot, 'location.country'),
    readPath(fnolSnapshot, 'country'),
    readPath(fnolSnapshot, 'lossCountry'),
  ];
  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (text) return text;
  }
  return '';
}

export function computeClaimComplianceGaps(args: {
  claimData: Record<string, unknown>;
  fnolSnapshot: Record<string, unknown>;
  projection: ProjectionLike;
  resolvedLossCountry: string;
}): string[] {
  const { claimData, projection, resolvedLossCountry } = args;
  const complianceGaps: string[] = [];
  if (!resolvedLossCountry) complianceGaps.push('CR0116 loss country missing');
  if (resolvedLossCountry && !isEuCountry(resolvedLossCountry)) {
    complianceGaps.push(`Loss country outside EU coverage (${resolvedLossCountry})`);
  }
  if (!String(claimData.cr0119_date_of_loss_from || '').trim()) {
    complianceGaps.push('CR0119 date of loss missing');
  }
  if (!String(claimData.cr0117_cause_of_loss_code || '').trim() && !String(claimData.cr0118_loss_description || '').trim()) {
    complianceGaps.push('CR0117 or CR0118 required');
  }
  if (projection.cr0107Denial === 'Y' && !projection.deniedAt) complianceGaps.push('CR0311 denial date missing');
  if ((projection.status === 'CLOSED' || projection.status === 'CLOSED_THIS_MONTH') && !projection.closedAt) {
    complianceGaps.push('CR0137 close date missing');
  }
  return complianceGaps;
}
