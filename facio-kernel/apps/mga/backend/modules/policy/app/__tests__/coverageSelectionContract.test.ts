import { beforeAll, describe, expect, it } from 'vitest';
import { buildDefaultProgramMbeProductConfig, normalizeProgramMbeProductConfig } from '../../../mbe/domain/programProduct.js';
import { resolveEffectiveCoverageContract } from '../../domain/coverageSelectionContract.js';
import { registerAllProducts } from '../../../../products/registerProducts.js';

beforeAll(() => {
  registerAllProducts();
});

const baseQuoteData = {
  coverRequired: 'Comprehensive',
  vehicleType: 'Car',
  requiredExcess: '300',
  protectNCB: false,
};

describe('coverageSelectionContract', () => {
  it('keeps classic-only clauses out of the effective contract for non-classic risks', () => {
    const cfg = normalizeProgramMbeProductConfig(buildDefaultProgramMbeProductConfig('abbeygate_motor'));
    const contract = resolveEffectiveCoverageContract({
      productType: 'MOTOR',
      quoteData: baseQuoteData,
      cfg,
      storedSelection: {},
      programId: 'prog-1',
      source: 'TEST',
    });

    expect(contract.defaults.selected.ABG001).toBe(false);
    expect(contract.selected.ABG001).toBeUndefined();
    expect(contract.resolvedCoverageSet.applied.some((entry) => entry.code === 'ABG001')).toBe(false);
    expect(contract.defaults.selected['CV 1028']).toBe(true);
    expect(contract.resolvedCoverageSet.applied.some((entry) => entry.code === 'CV 1028')).toBe(true);
  });

  it('accepts legacy persisted selections without programId and resolves them through the same contract', () => {
    const cfg = normalizeProgramMbeProductConfig(buildDefaultProgramMbeProductConfig('abbeygate_motor'));
    const contract = resolveEffectiveCoverageContract({
      productType: 'MOTOR',
      quoteData: baseQuoteData,
      cfg,
      storedSelection: {
        selected: { 'CV 172': true },
        params: { 'CV 172': { limit_eur: 5000 } },
        source: 'CUSTOMER_RECS',
      },
      programId: 'prog-1',
      source: 'TEST',
    });

    expect(contract.selected['CV 172']).toBe(true);
    expect(contract.params['CV 172']).toEqual({ limit_eur: 5000 });
    expect(contract.resolvedCoverageSet.applied.some((entry) => entry.code === 'CV 172')).toBe(true);
  });

  it('keeps saved selection truthful even when the resolved set differs', () => {
    const cfg = normalizeProgramMbeProductConfig(buildDefaultProgramMbeProductConfig('abbeygate_motor'));
    const contract = resolveEffectiveCoverageContract({
      productType: 'MOTOR',
      quoteData: baseQuoteData,
      cfg,
      storedSelection: {
        // Explicitly turn roadside off even though the defaults would include it for comprehensive.
        selected: { 'COV-ROADSIDE': false },
        params: {},
      },
      programId: 'prog-1',
      source: 'TEST',
    });

    // API truth: selected stays EXACTLY as saved.
    expect(contract.selected['COV-ROADSIDE']).toBe(false);
    // Resolved set is its own field — the UI/engine can compare, but the API
    // must not lie by mutating the saved snapshot.
    expect(contract.resolvedCoverageSet.selectedCodes.includes('COV-ROADSIDE')).toBe(false);
  });

  it('drops stored overrides from a different program to avoid cross-program drift', () => {
    const cfg = normalizeProgramMbeProductConfig(buildDefaultProgramMbeProductConfig('abbeygate_motor'));
    const contract = resolveEffectiveCoverageContract({
      productType: 'MOTOR',
      quoteData: baseQuoteData,
      cfg,
      storedSelection: {
        programId: 'other-program',
        selected: { 'CV 172': true },
        params: { 'CV 172': { limit_eur: 5000 } },
      },
      programId: 'prog-1',
      source: 'TEST',
    });

    expect(contract.selected['CV 172']).toBeUndefined();
    expect(contract.params['CV 172']).toBeUndefined();
    expect(contract.resolvedCoverageSet.applied.some((entry) => entry.code === 'CV 172')).toBe(false);
  });

  it('applies product-declared option triggers from quote data', () => {
    const cfg = normalizeProgramMbeProductConfig(buildDefaultProgramMbeProductConfig({ productType: 'TRAVEL' }), {
      productType: 'TRAVEL',
    });
    const contract = resolveEffectiveCoverageContract({
      productType: 'TRAVEL',
      quoteData: {
        addons: { gadget: true, businessCover: true },
      },
      cfg,
      storedSelection: {},
      programId: 'travel-prog-1',
      source: 'TEST',
    });

    expect(contract.resolvedCoverageSet.applied.some((entry) => entry.code === 'TRAVEL-GADGET')).toBe(true);
    expect(contract.resolvedCoverageSet.applied.some((entry) => entry.code === 'TRAVEL-BUSINESS-COVER')).toBe(true);
    expect(contract.resolvedCoverageSet.applied.some((entry) => entry.code === 'TRAVEL-WEDDING')).toBe(false);
  });
});
