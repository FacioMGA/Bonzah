import en from 'react-phone-number-input/locale/en';

export type SelectOption = { value: string; label: string };

function normalizeCountryName(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COUNTRY_NAME_TO_CODE_ALIASES: Record<string, string> = {
  [normalizeCountryName('Cabo Verde')]: 'CV',
  [normalizeCountryName('Congo (Congo-Brazzaville)')]: 'CG',
  [normalizeCountryName('Czechia (Czech Republic)')]: 'CZ',
  [normalizeCountryName('Democratic Republic of the Congo')]: 'CD',
  [normalizeCountryName('Eswatini (fmr. Swaziland)')]: 'SZ',
  [normalizeCountryName('Holy See')]: 'VA',
  [normalizeCountryName('Laos')]: 'LA',
  [normalizeCountryName('Micronesia')]: 'FM',
  [normalizeCountryName('Moldova')]: 'MD',
  [normalizeCountryName('Myanmar (formerly Burma)')]: 'MM',
  [normalizeCountryName('North Korea')]: 'KP',
  [normalizeCountryName('Palestine State')]: 'PS',
  [normalizeCountryName('Russia')]: 'RU',
  [normalizeCountryName('South Korea')]: 'KR',
  [normalizeCountryName('Syria')]: 'SY',
  [normalizeCountryName('Tanzania')]: 'TZ',
  [normalizeCountryName('United States of America')]: 'US',
  [normalizeCountryName('Venezuela')]: 'VE',
  [normalizeCountryName('Vietnam')]: 'VN',
};

const countryLabelEntries = Object.entries(en).filter(
  ([code, label]) => /^[A-Z]{2}$/.test(code) && typeof label === 'string' && String(label).trim().length > 0,
) as Array<[string, string]>;

const normalizedLocaleNameToCode = (() => {
  const map = new Map<string, string>();
  countryLabelEntries.forEach(([code, label]) => {
    const normalized = normalizeCountryName(label);
    if (normalized) map.set(normalized, code);
  });
  return map;
})();

function codeToFlagEmoji(code: string): string {
  const upper = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  return String.fromCodePoint(...upper.split('').map((char) => 127397 + char.charCodeAt(0)));
}

function resolveCountryCode(countryName: string): string | undefined {
  const normalized = normalizeCountryName(countryName);
  if (!normalized) return undefined;

  const aliasCode = COUNTRY_NAME_TO_CODE_ALIASES[normalized];
  if (aliasCode) return aliasCode;

  const exactCode = normalizedLocaleNameToCode.get(normalized);
  if (exactCode) return exactCode;

  for (const [localeName, code] of normalizedLocaleNameToCode.entries()) {
    if (localeName.includes(normalized) || normalized.includes(localeName)) {
      return code;
    }
  }
  return undefined;
}

export function getCountryFlagEmoji(countryName: string): string {
  const code = resolveCountryCode(countryName);
  if (!code) return '🏳️';
  return codeToFlagEmoji(code) || '🏳️';
}

export function addFlagsToCountryOptions(options: SelectOption[]): SelectOption[] {
  return options.map((option) => {
    const value = String(option.value || '').trim();
    if (!value) return option;
    return { ...option, label: `${getCountryFlagEmoji(value)} ${value}` };
  });
}
