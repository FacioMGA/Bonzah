import { beforeAll, describe, expect, it } from 'vitest';
import { buildDefaultProgramMbeProductConfig, normalizeProgramMbeProductConfig, resolveAppliedEndorsementsForQuote } from '../programProduct.js';
import { registerAllProducts } from '../../../../products/registerProducts.js';

beforeAll(() => {
  registerAllProducts();
});

describe('program MBE product defaults', () => {
  it('never falls back to abbeygate_motor for non-motor products', () => {
    const homeCfg = normalizeProgramMbeProductConfig({}, { productType: 'HOME' });
    const travelCfg = normalizeProgramMbeProductConfig({}, { productType: 'TRAVEL' });

    expect(homeCfg.programCode).toBe('abbeygate_home');
    expect(travelCfg.programCode).toBe('abbeygate_travel');
    expect(homeCfg.base.some((entry) => String(entry.code || '').startsWith('HOME-'))).toBe(true);
    expect(travelCfg.options.some((entry) => String(entry.code || '').startsWith('TRAVEL-'))).toBe(true);
  });

  it('repairs legacy motor config persisted onto non-motor products', () => {
    const legacyMotorConfig = {
      schemaVersion: 1,
      programCode: 'abbeygate_motor',
      base: [{ code: 'CV 999', enabled: true, params: {} }],
      options: [{ code: 'CV 24', enabledByDefault: true, params: {} }],
    };

    const homeCfg = normalizeProgramMbeProductConfig(legacyMotorConfig, { productType: 'HOME' });
    const travelCfg = normalizeProgramMbeProductConfig(legacyMotorConfig, { productType: 'TRAVEL' });

    expect(homeCfg.programCode).toBe('abbeygate_home');
    expect(travelCfg.programCode).toBe('abbeygate_travel');
    expect(homeCfg.base.some((entry) => String(entry.code || '').startsWith('HOME-'))).toBe(true);
    expect(travelCfg.base.some((entry) => String(entry.code || '').startsWith('TRAVEL-'))).toBe(true);
  });

  it('reconciles catalog templates added after a config was persisted (as disabled options)', () => {
    // A HEALTH program config saved before HEALTH-GESY-CLAIMS-CONDITION
    // shipped: the new code is in the catalog but not in the stored arrays.
    const persistedPreGesy = {
      schemaVersion: 1,
      programCode: 'abbeygate_health',
      base: [{ code: 'HEALTH-BASE-COVER', enabled: true, params: {} }],
      options: [{ code: 'HEALTH-GHS-EXTENSION', enabledByDefault: false, params: {} }],
    };

    const cfg = normalizeProgramMbeProductConfig(persistedPreGesy, { productType: 'HEALTH' });

    const appended = cfg.options.find((o) => o.code === 'HEALTH-GESY-CLAIMS-CONDITION');
    expect(appended).toBeTruthy();
    // Never auto-enabled: reconciliation appends as a disabled option; the
    // quote-time selectedWhen rule (from the catalog) is what activates it.
    expect(appended?.enabledByDefault).toBe(false);
    // Stored entries are untouched.
    expect(cfg.base.map((b) => b.code)).toEqual(['HEALTH-BASE-COVER']);
    expect(cfg.options.filter((o) => o.code === 'HEALTH-GHS-EXTENSION')).toHaveLength(1);
  });

  it('evaluates selectedWhen for reconciled options on existing-program quotes', () => {
    const persistedPreGesy = {
      schemaVersion: 1,
      programCode: 'abbeygate_health',
      base: [{ code: 'HEALTH-BASE-COVER', enabled: true, params: {} }],
      options: [{ code: 'HEALTH-GHS-EXTENSION', enabledByDefault: false, params: {} }],
    };
    const cfg = normalizeProgramMbeProductConfig(persistedPreGesy, { productType: 'HEALTH' });

    const gesyApplied = resolveAppliedEndorsementsForQuote({
      quoteData: { ghs: { isBeneficiary: true } },
      cfg,
    });
    const nonGesyApplied = resolveAppliedEndorsementsForQuote({
      quoteData: { ghs: { isBeneficiary: false } },
      cfg,
    });

    expect(gesyApplied.some((x) => x.code === 'HEALTH-GESY-CLAIMS-CONDITION')).toBe(true);
    expect(gesyApplied.some((x) => x.code === 'HEALTH-GHS-EXTENSION')).toBe(true);
    expect(nonGesyApplied.some((x) => x.code === 'HEALTH-GESY-CLAIMS-CONDITION')).toBe(false);
    expect(nonGesyApplied.some((x) => x.code === 'HEALTH-GHS-EXTENSION')).toBe(false);
  });

  it('enables roadside by default for comprehensive and keeps it optional for TPL', () => {
    const cfg = normalizeProgramMbeProductConfig(buildDefaultProgramMbeProductConfig('abbeygate_motor'));
    const compApplied = resolveAppliedEndorsementsForQuote({
      quoteData: { coverRequired: 'Comprehensive', vehicleType: 'Car' },
      cfg,
    });
    const tplApplied = resolveAppliedEndorsementsForQuote({
      quoteData: { coverRequired: 'Third Party Liability', vehicleType: 'Car' },
      cfg,
    });
    expect(compApplied.some((x) => x.code === 'COV-ROADSIDE')).toBe(true);
    expect(tplApplied.some((x) => x.code === 'COV-ROADSIDE')).toBe(false);
  });

  it('applies CV4/CV5 only for comprehensive and wires excess amount from quote data', () => {
    const cfg = normalizeProgramMbeProductConfig(buildDefaultProgramMbeProductConfig('abbeygate_motor'));
    const compApplied = resolveAppliedEndorsementsForQuote({
      quoteData: { coverRequired: 'Comprehensive', vehicleType: 'Car', requiredExcess: '€450' },
      cfg,
    });
    const cv4 = compApplied.find((x) => x.code === 'CV 4');
    const cv5 = compApplied.find((x) => x.code === 'CV 5');
    expect(cv4).toBeTruthy();
    expect(cv5).toBeTruthy();
    expect(Number((cv4?.params as Record<string, unknown>)?.excess_amount_eur || 0)).toBe(450);
    expect(Number((cv5?.params as Record<string, unknown>)?.excess_amount_eur || 0)).toBe(450);

    const tplApplied = resolveAppliedEndorsementsForQuote({
      quoteData: { coverRequired: 'Third Party Liability', vehicleType: 'Car', requiredExcess: '€450' },
      cfg,
    });
    expect(tplApplied.some((x) => x.code === 'CV 4')).toBe(false);
    expect(tplApplied.some((x) => x.code === 'CV 5')).toBe(false);
  });
});

