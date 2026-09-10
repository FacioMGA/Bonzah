import { loadWildfireRiskTiers } from '../pricing/data/wildfire-risk-tiers.loader.js';
import { WILDFIRE_TIERS, type WildfireClassificationTier, type WildfireTier } from '../pricing/data/wildfire-risk-tiers.schema.js';

export interface WildfireRiskInput {
  country?: string;
  town?: string;
  province?: string;
  postcode?: string;
  officialHazardClass?: string;
}

export interface WildfireRiskClassification {
  tier: WildfireClassificationTier;
  countryCode: string | null;
  matchedTier: WildfireTier | null;
  matchedLabel: string | null;
  matchedOn: 'official' | 'name' | 'keyword' | 'none';
}

const COUNTRY_TO_CODE: Readonly<Record<string, string>> = {
  cy: 'CY',
  cyp: 'CY',
  cyprus: 'CY',
  pt: 'PT',
  prt: 'PT',
  portugal: 'PT',
  es: 'ES',
  esp: 'ES',
  spain: 'ES',
  gr: 'GR',
  grc: 'GR',
  greece: 'GR',
};

export function normalizeWildfireRiskKey(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function countryCodeFor(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return COUNTRY_TO_CODE[normalizeWildfireRiskKey(raw)] || null;
}

function officialHazardRedOverride(countryCode: string, value: unknown): WildfireRiskClassification | null {
  const hazardClass = normalizeWildfireRiskKey(value);
  if (countryCode !== 'PT') return null;
  if (hazardClass !== 'alta' && hazardClass !== 'muito alta') return null;
  return {
    tier: 'red',
    countryCode,
    matchedTier: 'red',
    matchedLabel: 'Portugal ICNF Alta/Muito Alta structural hazard',
    matchedOn: 'official',
  };
}

export function classifyWildfireRisk(input: WildfireRiskInput): WildfireRiskClassification {
  const countryCode = countryCodeFor(input.country);
  if (!countryCode) {
    return { tier: 'unclassified', countryCode: null, matchedTier: null, matchedLabel: null, matchedOn: 'none' };
  }

  const officialOverride = officialHazardRedOverride(countryCode, input.officialHazardClass);
  if (officialOverride) return officialOverride;

  const country = loadWildfireRiskTiers().tiers[countryCode];
  if (!country) {
    return { tier: 'unclassified', countryCode, matchedTier: null, matchedLabel: null, matchedOn: 'none' };
  }

  const parts = [input.town, input.province, input.postcode].map(normalizeWildfireRiskKey).filter(Boolean);
  const searchText = parts.join(' ');
  if (!searchText) {
    return { tier: 'unclassified', countryCode, matchedTier: null, matchedLabel: null, matchedOn: 'none' };
  }

  for (const tier of WILDFIRE_TIERS) {
    for (const entry of country[tier]) {
      const names = entry.names.map(normalizeWildfireRiskKey);
      if (names.some((name) => parts.includes(name))) {
        return { tier, countryCode, matchedTier: tier, matchedLabel: entry.label, matchedOn: 'name' };
      }
    }
  }

  for (const tier of WILDFIRE_TIERS) {
    for (const entry of country[tier]) {
      const keywords = entry.keywords.map(normalizeWildfireRiskKey);
      if (keywords.some((keyword) => keyword && searchText.includes(keyword))) {
        return { tier, countryCode, matchedTier: tier, matchedLabel: entry.label, matchedOn: 'keyword' };
      }
    }
  }

  return { tier: 'unclassified', countryCode, matchedTier: null, matchedLabel: null, matchedOn: 'none' };
}
