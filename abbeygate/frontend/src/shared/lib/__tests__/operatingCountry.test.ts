import { describe, expect, it } from 'vitest';
import { getOperatingCountryFromHost, getOperatingCountryName } from '../tenant/operatingCountry';

/**
 * `getOperatingCountryFromHost` is the only Frontend-side
 * tenant→country map used to scope UX (e.g. address-autocomplete
 * region restriction in ABY-299). It MUST stay in lockstep with the
 * canonical host map enforced server-side by
 * `backend/platform/http/middleware/resolveTenant.ts`.
 *
 * Returning `null` for unknown hosts is the explicit "no restriction"
 * signal — `no-defensive-fallbacks` forbids silently coercing to
 * `'CY'` for dev / unknown environments.
 */

describe('getOperatingCountryFromHost', () => {
  it('returns the operating country for each legacy Abbeygate tenant host', () => {
    expect(getOperatingCountryFromHost('abbeygate-cy.facio.io')).toBe('CY');
    expect(getOperatingCountryFromHost('abbeygate-pt.facio.io')).toBe('PT');
    expect(getOperatingCountryFromHost('abbeygate-gr.facio.io')).toBe('GR');
    expect(getOperatingCountryFromHost('abbeygate-es.facio.io')).toBe('ES');
  });

  it('returns the operating country for the production abbeygate.com domains', () => {
    expect(getOperatingCountryFromHost('cy.abbeygate.com')).toBe('CY');
    expect(getOperatingCountryFromHost('pt.abbeygate.com')).toBe('PT');
    expect(getOperatingCountryFromHost('gr.abbeygate.com')).toBe('GR');
  });

  it('returns the operating country for the staging abbeygate.com domains', () => {
    expect(getOperatingCountryFromHost('cy.staging.abbeygate.com')).toBe('CY');
    expect(getOperatingCountryFromHost('pt.staging.abbeygate.com')).toBe('PT');
    expect(getOperatingCountryFromHost('gr.staging.abbeygate.com')).toBe('GR');
  });

  it('lower-cases and trims the input so a stray Host capitalisation never breaks the match', () => {
    expect(getOperatingCountryFromHost('ABBEYGATE-CY.facio.io')).toBe('CY');
    expect(getOperatingCountryFromHost('  abbeygate-pt.facio.io  ')).toBe('PT');
  });

  it('returns null for localhost / unknown hosts (no defensive default)', () => {
    expect(getOperatingCountryFromHost('localhost')).toBeNull();
    expect(getOperatingCountryFromHost('127.0.0.1')).toBeNull();
    expect(getOperatingCountryFromHost('preview-abc.staging.facio.io')).toBeNull();
    expect(getOperatingCountryFromHost('')).toBeNull();
  });
});

/**
 * `getOperatingCountryName` derives the canonical country NAME used for
 * wizard field defaults (country of registration / domicile / address
 * country). Powers ABY-322/332/337: on a Portugal tenant the wizards
 * must default to Portugal, never Cyprus.
 */
describe('getOperatingCountryName', () => {
  it('returns the canonical country name for each Abbeygate tenant host', () => {
    expect(getOperatingCountryName('abbeygate-cy.facio.io')).toBe('Cyprus');
    expect(getOperatingCountryName('abbeygate-pt.facio.io')).toBe('Portugal');
    expect(getOperatingCountryName('abbeygate-gr.facio.io')).toBe('Greece');
    expect(getOperatingCountryName('abbeygate-es.facio.io')).toBe('Spain');
    expect(getOperatingCountryName('gr.abbeygate.com')).toBe('Greece');
    expect(getOperatingCountryName('pt.staging.abbeygate.com')).toBe('Portugal');
  });

  it('returns null for localhost / unknown hosts (no defensive Cyprus default)', () => {
    expect(getOperatingCountryName('localhost')).toBeNull();
    expect(getOperatingCountryName('preview-abc.staging.facio.io')).toBeNull();
    expect(getOperatingCountryName('')).toBeNull();
  });
});
