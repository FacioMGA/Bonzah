import crypto from 'crypto';
import fs from 'fs';
import { describe, expect, it } from 'vitest';
import {
  HomeIpidNotConfiguredError,
  HomePolicyWordingNotConfiguredError,
  isUkDomicileCountry,
  listHomeIpidAssets,
  listHomePolicyWordingAssets,
  resolveHomeIpid,
  resolveHomePolicyWording,
  resolveHomeWordingDomicile,
} from '../policyWording.js';

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('resolveHomePolicyWording — tenant × domicile matrix (ADR-0048)', () => {
  it('returns the Cyprus non-UK wording for CY / NON_UK', () => {
    const w = resolveHomePolicyWording('CY', 'NON_UK');
    expect(w.reference).toBe('BZ/ABG/8.2026/CY');
    expect(w.filename).toBe('Home_Policy_Wording_Cyprus_Domiciled.pdf');
  });

  it('returns the Cyprus UK-domiciled wording for CY / UK', () => {
    const w = resolveHomePolicyWording('CY', 'UK');
    expect(w.reference).toBe('BZ/ABG/8.2026/CYUK');
    expect(w.filename).toBe('Home_Policy_Wording_Cyprus_UK_Domiciled.pdf');
  });

  it('returns the Portugal non-UK wording for PT / NON_UK', () => {
    const w = resolveHomePolicyWording('PT', 'NON_UK');
    expect(w.reference).toBe('BZ/ABG/8.2026/PT');
    expect(w.filename).toBe('Home_Policy_Wording_Portugal_Domiciled.pdf');
  });

  it('returns the Portugal UK-domiciled wording for PT / UK', () => {
    const w = resolveHomePolicyWording('PT', 'UK');
    expect(w.reference).toBe('BZ/ABG/8.2026/PTUK');
    expect(w.filename).toBe('Home_Policy_Wording_Portugal_UK_Domiciled.pdf');
  });

  it('returns the Greece non-UK wording for GR / NON_UK (ADR-0073)', () => {
    const w = resolveHomePolicyWording('GR', 'NON_UK');
    expect(w.reference).toBe('BZ/ABG/8.2026/GR');
    expect(w.filename).toBe('Home_Policy_Wording_Greece_Domiciled.pdf');
  });

  it('returns the Greece UK-domiciled wording for GR / UK (ADR-0073)', () => {
    const w = resolveHomePolicyWording('GR', 'UK');
    expect(w.reference).toBe('BZ/ABG/8.2026/GRUK');
    expect(w.filename).toBe('Home_Policy_Wording_Greece_UK_Domiciled.pdf');
  });

  it('uses distinct Greece wordings per domicile (no longer a single wording)', () => {
    const gr = resolveHomePolicyWording('GR', 'NON_UK');
    const grUk = resolveHomePolicyWording('GR', 'UK');
    expect(grUk.staticPdfPath).not.toBe(gr.staticPdfPath);
    expect(grUk.reference).not.toBe(gr.reference);
  });

  it('never returns the same wording for two different territories', () => {
    const cy = resolveHomePolicyWording('CY', 'NON_UK');
    const pt = resolveHomePolicyWording('PT', 'NON_UK');
    expect(cy.staticPdfPath).not.toBe(pt.staticPdfPath);
    expect(cy.reference).not.toBe(pt.reference);
  });

  it.each(['ES', 'IT', '', 'XX'])(
    'fails loud for unconfigured territory %s instead of falling back to Cyprus',
    (country) => {
      expect(() => resolveHomePolicyWording(country, 'NON_UK')).toThrow(
        HomePolicyWordingNotConfiguredError,
      );
    },
  );

  it('has every configured static wording asset present on disk', () => {
    for (const asset of listHomePolicyWordingAssets()) {
      expect(fs.existsSync(asset.staticPdfPath), `${asset.filename} → ${asset.staticPdfPath}`).toBe(
        true,
      );
      expect(fs.statSync(asset.staticPdfPath).size).toBeGreaterThan(0);
    }
  });

  it('pins every approved 19 Aug 2026 source PDF by SHA-256', () => {
    const expected = new Map([
      [
        'Home_Policy_Wording_Cyprus_Domiciled.pdf',
        '5c1af264493db5d255c9e78f53a5ee67f814236f95e30fc777a2b302c9849b04',
      ],
      [
        'Home_Policy_Wording_Cyprus_UK_Domiciled.pdf',
        '1ae5ea17297192ca0cbaa7ac4f30a880f88e789f40ea122eb20626f850975452',
      ],
      [
        'Home_Policy_Wording_Portugal_Domiciled.pdf',
        '5bedb53c1ba217dcbb746aee7e03c859ca12bc92c729be0be89cff9cc222db77',
      ],
      [
        'Home_Policy_Wording_Portugal_UK_Domiciled.pdf',
        'b1359cec8a1d5014d01697e406742ec478c30982306504c6455ad1414519cc8e',
      ],
      [
        'Home_Policy_Wording_Greece_Domiciled.pdf',
        '283d9397127a7e1e50fdcbf72c6c0e630d1d66615ed60b6a2d982510f57d087a',
      ],
      [
        'Home_Policy_Wording_Greece_UK_Domiciled.pdf',
        'c7d3cf67274d2ebae10d8282aedd7643506b5400498f1d4de0c70fe70bb9bcb3',
      ],
    ]);

    for (const asset of listHomePolicyWordingAssets()) {
      expect(asset.assetVersion).toContain('2026-08-19');
      expect(sha256(asset.staticPdfPath), asset.filename).toBe(expected.get(asset.filename));
    }
  });
});

describe('resolveHomeIpid — territory-aware IPID (ADR-0048)', () => {
  it('uses the Greece-specific IPID for GR', () => {
    expect(resolveHomeIpid('GR').filename).toBe('Home_IPID_Lloyds_Greece.pdf');
  });

  it('uses the approved dedicated Spain/Portugal IPID for PT', () => {
    const cy = resolveHomeIpid('CY');
    const pt = resolveHomeIpid('PT');
    expect(cy.filename).toBe('Home_IPID_Beazley_Cyprus_Greece_2023.pdf');
    expect(pt.filename).toBe('Home_IPID_Beazley_Spain_Portugal.pdf');
    expect(pt.staticPdfPath).not.toBe(cy.staticPdfPath);
  });

  it('does not emit the Greece IPID for Cyprus/Portugal', () => {
    expect(resolveHomeIpid('CY').staticPdfPath).not.toBe(resolveHomeIpid('GR').staticPdfPath);
  });

  it.each(['ES', 'IT', '', 'XX'])('fails loud for unconfigured territory %s', (country) => {
    expect(() => resolveHomeIpid(country)).toThrow(HomeIpidNotConfiguredError);
  });

  it('has every configured IPID asset present on disk', () => {
    for (const asset of listHomeIpidAssets()) {
      expect(fs.existsSync(asset.staticPdfPath), `${asset.filename} → ${asset.staticPdfPath}`).toBe(
        true,
      );
      expect(fs.statSync(asset.staticPdfPath).size).toBeGreaterThan(0);
    }
  });

  it('pins the approved Spain/Portugal IPID source PDF by SHA-256', () => {
    const portugal = resolveHomeIpid('PT');
    expect(sha256(portugal.staticPdfPath)).toBe(
      '9299bf6cf380c1056579ac827e1f63c5fcb93842f2f4e4a9b9972027bff64a19',
    );
  });
});

describe('isUkDomicileCountry', () => {
  it.each(['United Kingdom', 'united kingdom', 'UK', 'uk', 'U.K.'])('treats %s as UK', (value) => {
    expect(isUkDomicileCountry(value)).toBe(true);
  });

  it.each(['Cyprus', 'Portugal', 'Ireland', '', undefined, null])(
    'treats %s as non-UK',
    (value) => {
      expect(isUkDomicileCountry(value)).toBe(false);
    },
  );
});

describe('resolveHomeWordingDomicile — primary insured only', () => {
  it('is UK when the primary proposer is UK-domiciled', () => {
    expect(resolveHomeWordingDomicile({ proposer: { domicileCountry: 'United Kingdom' } })).toBe(
      'UK',
    );
  });

  it('is NON_UK when a joint policyholder is UK-domiciled but the primary is not', () => {
    expect(
      resolveHomeWordingDomicile({
        proposer: { domicileCountry: 'Portugal' },
        policyHolders: [{ domicileCountry: 'United Kingdom' }],
      }),
    ).toBe('NON_UK');
  });

  it('is UK when the primary is UK-domiciled even if a joint holder is not', () => {
    expect(
      resolveHomeWordingDomicile({
        proposer: { domicileCountry: 'United Kingdom' },
        policyHolders: [{ domicileCountry: 'Portugal' }],
      }),
    ).toBe('UK');
  });

  it('is NON_UK when the primary proposer is not UK-domiciled', () => {
    expect(resolveHomeWordingDomicile({ proposer: { domicileCountry: 'Cyprus' } })).toBe('NON_UK');
  });

  it('is NON_UK when domicile is absent (does not silently assume UK)', () => {
    expect(resolveHomeWordingDomicile({})).toBe('NON_UK');
  });
});
