import fs from 'fs';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MotorPolicyWordingNotConfiguredError,
  MotorIpidNotConfiguredError,
  resolveMotorIpid,
  resolveMotorPolicyWording,
} from '../policyWording.js';

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('Motor policy wording selection', () => {
  it.each([
    ['CY', 'Cyprus'],
    ['PT', 'Portugal'],
    ['ES', 'Spain'],
  ])('selects the approved AB/S/1/2026 wording for %s', (countryCode, countryName) => {
    const asset = resolveMotorPolicyWording(countryCode);
    expect(asset.reference).toBe('AB/S/1/2026');
    expect(asset.filename).toContain(countryName);
    expect(fs.existsSync(asset.staticPdfPath)).toBe(true);
    expect(fs.statSync(asset.staticPdfPath).size).toBeGreaterThan(100_000);
  });

  it('does not fall back to a different territory', () => {
    expect(() => resolveMotorPolicyWording('GR')).toThrow(MotorPolicyWordingNotConfiguredError);
  });

  it('uses the exact approved 19 Aug 2026 CY/PT/ES wording assets', () => {
    const cy = resolveMotorPolicyWording('CY');
    const pt = resolveMotorPolicyWording('PT');
    const es = resolveMotorPolicyWording('ES');
    expect(cy.assetVersion).toContain('2026-08-19');
    expect(pt.assetVersion).toContain('2026-08-19');
    expect(es.assetVersion).toContain('2026-08-19');
    expect(sha256(cy.staticPdfPath)).toBe(
      '06984e1ec081b9e39e98377f7b430de24e5afb61dc860ae1b69ff800666ef123',
    );
    expect(sha256(pt.staticPdfPath)).toBe(
      '4f958ac297142d2ed9e15e3d3f09249cad8f5a3989e31a0ec10dedb833efc1cc',
    );
    expect(sha256(es.staticPdfPath)).toBe(
      'a6a8a21c5a1b03472ec6f30602ec2b294761b010d6c5216cc3b01e6fe179dc4c',
    );
  });
});

describe('Motor IPID selection', () => {
  it('uses the exact approved Santam Cyprus IPID', () => {
    const asset = resolveMotorIpid('CY');
    expect(asset.filename).toBe('Abbeygate_Motor_Cyprus_IPID_LIC_Santam_UMR_B176026EEA6152.pdf');
    expect(asset.assetVersion).toContain('SNT5436:B176026EEA6152');
    expect(sha256(asset.staticPdfPath)).toBe(
      '1299b9271e210defabff70a682a81b6df548e1922b041dbcf89fb30dab43711a',
    );
  });

  it('uses the exact approved Portugal August 2026 IPID', () => {
    const asset = resolveMotorIpid('PT');
    expect(asset.filename).toBe('Abbeygate_Motor_Portugal_IPID_LIC_Santam_August2026.pdf');
    expect(sha256(asset.staticPdfPath)).toBe('4a0653daeb2d808b7bded8bcb194f40932fa9e0c8c34f7a6216e6054371922a2');
    expect(asset.staticPdfPath).not.toBe(resolveMotorIpid('CY').staticPdfPath);
  });

  it('does not fall back to the Cyprus IPID for another territory', () => {
    expect(() => resolveMotorIpid('GR')).toThrow(MotorIpidNotConfiguredError);
  });
});
