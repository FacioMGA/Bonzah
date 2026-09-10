import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('Policy pack metadata', () => {
  it('keeps coverholder and UMR footer rendering in doc generator', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const generatorPath = path.resolve(testDir, '../generateMotorDocPack.ts');
    const source = fs.readFileSync(generatorPath, 'utf8');
    expect(source.includes('UMR:')).toBe(true);
    expect(source.toLowerCase().includes('coverholder')).toBe(true);
  });

  it('renders the bound binder UMR on the Motor issued schedule', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const templatePath = path.resolve(testDir, '../templates/schedule.html');
    const source = fs.readFileSync(templatePath, 'utf8');
    expect(source).toContain('Coverholder UMR');
    expect(source).toContain('{{umr}}');
  });
});
