/**
 * Abbeygate operating-territory nationality matcher.
 *
 * Abbeygate is an expat broker. Nationals of the same operating market as
 * the risk/residence are local-market customers and must be referred
 * (ADR-0059). Cross-territory operating nationals remain expats: e.g.
 * Portuguese nationals in Cyprus and Cypriot nationals in Portugal can
 * proceed online unless another product rule catches them.
 *
 * Canonical owner of "does this nationality string name a local-market
 * national?". Product UW engines consume this; they must not re-state
 * CY/PT/GR/ES/IT alias lists or country-pair policy.
 *
 * Wizard nationality stores canonical country NAMES (see
 * `@facio/validation` nationality contract). Demonym / ISO spellings are
 * matched defensively for imports and legacy rows.
 */

export type OperatingTerritoryCode = 'CY' | 'PT' | 'GR' | 'ES' | 'IT';

export type OperatingTerritoryNationalMatch = {
  territory: OperatingTerritoryCode;
  /** Human label for UW messages, e.g. "Cypriot". */
  demonym: string;
  /** Canonical country name, e.g. "Cyprus". */
  countryName: string;
};

const TERRITORY_ALIASES: ReadonlyArray<{
  territory: OperatingTerritoryCode;
  demonym: string;
  countryName: string;
  aliases: ReadonlySet<string>;
}> = [
  {
    territory: 'CY',
    demonym: 'Cypriot',
    countryName: 'Cyprus',
    aliases: new Set(['cyprus', 'cypriot', 'cy', 'republic of cyprus']),
  },
  {
    territory: 'PT',
    demonym: 'Portuguese',
    countryName: 'Portugal',
    aliases: new Set(['portugal', 'portuguese', 'pt']),
  },
  {
    territory: 'GR',
    demonym: 'Greek',
    countryName: 'Greece',
    aliases: new Set(['greece', 'greek', 'gr', 'hellenic republic']),
  },
  {
    territory: 'ES',
    demonym: 'Spanish',
    countryName: 'Spain',
    aliases: new Set(['spain', 'spanish', 'es', 'espana', 'españa']),
  },
  {
    territory: 'IT',
    demonym: 'Italian',
    countryName: 'Italy',
    aliases: new Set(['italy', 'italian', 'it', 'italia']),
  },
];

const LOCAL_MARKET_REFERRAL_TERRITORIES = new Set<OperatingTerritoryCode>(['CY', 'PT', 'GR']);

function normalizeNationalityToken(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s._-]+/g, ' ')
    .replace(/[()']/g, '');
}

/** Match a nationality value to an Abbeygate operating territory, or null. */
export function matchOperatingTerritoryNationality(
  value: unknown,
): OperatingTerritoryNationalMatch | null {
  const token = normalizeNationalityToken(value);
  if (!token) return null;
  for (const row of TERRITORY_ALIASES) {
    if (row.aliases.has(token)) {
      return {
        territory: row.territory,
        demonym: row.demonym,
        countryName: row.countryName,
      };
    }
  }
  return null;
}

/** True when nationality is CY / PT / GR / ES / IT (local-market national). */
export function isOperatingTerritoryNational(value: unknown): boolean {
  return matchOperatingTerritoryNationality(value) !== null;
}

/**
 * Return a local-market nationality referral match only when nationality and
 * operating/risk territory are the same live market. Peter confirmed on
 * 2026-08-07 that CY/PT/GR same-market pairs refer; everyone else is an expat
 * for this rule.
 */
export function matchLocalMarketNationalityReferral(
  nationality: unknown,
  market: unknown,
): OperatingTerritoryNationalMatch | null {
  const national = matchOperatingTerritoryNationality(nationality);
  if (!national) return null;
  if (!LOCAL_MARKET_REFERRAL_TERRITORIES.has(national.territory)) return null;
  const marketMatch = matchOperatingTerritoryNationality(market);
  if (!marketMatch || !LOCAL_MARKET_REFERRAL_TERRITORIES.has(marketMatch.territory)) return null;
  return marketMatch.territory === national.territory ? national : null;
}
