import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVehicleUseLimitations } from '../../../../modules/documents/app/vehicleUseLimitations.js';

describe('Class of use parity', () => {
  it('keeps schedule and certificate templates aligned to canonical limitations placeholders', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const schedulePath = path.resolve(testDir, '../templates/schedule.html');
    const certificatePath = path.resolve(testDir, '../templates/certificate.html');
    const schedule = fs.readFileSync(schedulePath, 'utf8');
    const certificate = fs.readFileSync(certificatePath, 'utf8');
    expect(schedule.includes('{{limitations.use_text}}')).toBe(true);
    expect(certificate.includes('{{limitations.use_text}}')).toBe(true);
    expect(schedule.includes('{{limitations.excluding_text}}')).toBe(true);
    expect(certificate.includes('{{limitations.excluding_text}}')).toBe(true);
  });

  it('returns canonical wording for supported classes', () => {
    for (const key of ['SD&P', 'Class 1', 'Class 2', 'Class 3']) {
      const wording = resolveVehicleUseLimitations(key);
      expect(String(wording.useText || '').length).toBeGreaterThan(30);
      expect(String(wording.excludingText || '').length).toBeGreaterThan(30);
    }
  });
});
