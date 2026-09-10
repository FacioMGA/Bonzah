import { describe, expect, it } from 'vitest';
import {
  isOperatingTerritoryNational,
  matchLocalMarketNationalityReferral,
  matchOperatingTerritoryNationality,
} from '../operatingTerritoryNationality.js';

describe('operatingTerritoryNationality', () => {
  it('matches every operating territory by country name, demonym, and ISO', () => {
    expect(matchOperatingTerritoryNationality('Cyprus')?.territory).toBe('CY');
    expect(matchOperatingTerritoryNationality('cypriot')?.territory).toBe('CY');
    expect(matchOperatingTerritoryNationality('CY')?.territory).toBe('CY');
    expect(matchOperatingTerritoryNationality('Republic of Cyprus')?.territory).toBe('CY');

    expect(matchOperatingTerritoryNationality('Portugal')?.territory).toBe('PT');
    expect(matchOperatingTerritoryNationality('Portuguese')?.territory).toBe('PT');
    expect(matchOperatingTerritoryNationality('pt')?.territory).toBe('PT');

    expect(matchOperatingTerritoryNationality('Greece')?.territory).toBe('GR');
    expect(matchOperatingTerritoryNationality('Greek')?.territory).toBe('GR');
    expect(matchOperatingTerritoryNationality('GR')?.territory).toBe('GR');

    expect(matchOperatingTerritoryNationality('Spain')?.territory).toBe('ES');
    expect(matchOperatingTerritoryNationality('Spanish')?.territory).toBe('ES');
    expect(matchOperatingTerritoryNationality('ES')?.territory).toBe('ES');
    expect(matchOperatingTerritoryNationality('España')?.territory).toBe('ES');

    expect(matchOperatingTerritoryNationality('Italy')?.territory).toBe('IT');
    expect(matchOperatingTerritoryNationality('Italian')?.territory).toBe('IT');
    expect(matchOperatingTerritoryNationality('IT')?.territory).toBe('IT');
    expect(matchOperatingTerritoryNationality('Italia')?.territory).toBe('IT');
  });

  it('does not match expat nationalities', () => {
    expect(isOperatingTerritoryNational('United Kingdom')).toBe(false);
    expect(isOperatingTerritoryNational('Germany')).toBe(false);
    expect(isOperatingTerritoryNational('')).toBe(false);
    expect(isOperatingTerritoryNational(undefined)).toBe(false);
  });

  it('refers only when nationality matches a live local referral market', () => {
    expect(matchLocalMarketNationalityReferral('Portuguese', 'Portugal')?.territory).toBe('PT');
    expect(matchLocalMarketNationalityReferral('Cypriot', 'Cyprus')?.territory).toBe('CY');
    expect(matchLocalMarketNationalityReferral('Greek', 'Greece')?.territory).toBe('GR');

    expect(matchLocalMarketNationalityReferral('Portuguese', 'Cyprus')).toBeNull();
    expect(matchLocalMarketNationalityReferral('Cypriot', 'Portugal')).toBeNull();
    expect(matchLocalMarketNationalityReferral('Greek', 'Republic of Cyprus')).toBeNull();
  });

  it('allows operating-territory nationals outside the live same-market pairs', () => {
    expect(matchLocalMarketNationalityReferral('Portuguese', '')).toBeNull();
    expect(matchLocalMarketNationalityReferral('Cypriot', 'United Kingdom')).toBeNull();
    expect(matchLocalMarketNationalityReferral('Spanish', 'Spain')).toBeNull();
    expect(matchLocalMarketNationalityReferral('Italian', 'Italy')).toBeNull();
  });
});
