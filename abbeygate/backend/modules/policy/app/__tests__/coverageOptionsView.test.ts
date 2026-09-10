import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllProducts } from '../../../../products/registerProducts.js';
import { ProductRegistry } from '../../domain/ProductRegistry.js';
import { buildDefaultProgramMbeProductConfig, normalizeProgramMbeProductConfig } from '../../../mbe/domain/programProduct.js';
import { resolveEffectiveCoverageContract } from '../coverageSelectionContract.js';
import { buildCoverageOptionsView } from '../coverageOptionsView.js';

beforeAll(() => {
  registerAllProducts();
});

describe('coverageOptionsView', () => {
  it('does not duplicate motor coverage items across sections', () => {
    const adapter = ProductRegistry.getInstance().getAdapter('MOTOR');
    if (!adapter) throw new Error('Motor adapter missing');
    const cfg = normalizeProgramMbeProductConfig(buildDefaultProgramMbeProductConfig({ productType: 'MOTOR' }), {
      productType: 'MOTOR',
    });
    const contract = resolveEffectiveCoverageContract({
      productType: 'MOTOR',
      quoteData: { coverRequired: 'Comprehensive', vehicleType: 'Car', make: 'Toyota', model: 'Yaris', registrationNumber: 'ABC123' },
      cfg,
      storedSelection: {},
      programId: 'prog-1',
    });

    const view = buildCoverageOptionsView({
      manifest: adapter.getManifest(),
      groups: adapter.getEndorsementGroups(),
      templates: adapter.getEndorsementCatalog().filter((template) => template.program_code === contract.programCode),
      contract,
      activeInstances: [],
      quoteData: { coverRequired: 'Comprehensive', vehicleType: 'Car', make: 'Toyota', model: 'Yaris', registrationNumber: 'ABC123' },
    });

    const codes = view.sections.flatMap((section) => section.items.map((item) => item.code));
    expect(codes.filter((code) => code === 'COV-TPL')).toHaveLength(1);
    expect(codes.filter((code) => code === 'COV-TPFT')).toHaveLength(1);
    expect(codes.filter((code) => code === 'COV-ROADSIDE-VIP')).toHaveLength(1);
    const scopes = view.sections.flatMap((section) => section.items.map((item) => item.scope));
    expect(scopes).not.toContain('VEHICLE');
  });

  it('returns populated home sections from the hand-authored backend catalog', () => {
    const adapter = ProductRegistry.getInstance().getAdapter('HOME');
    if (!adapter) throw new Error('Home adapter missing');
    const cfg = normalizeProgramMbeProductConfig(buildDefaultProgramMbeProductConfig({ productType: 'HOME' }), {
      productType: 'HOME',
    });
    const quoteData = {
      coverage: { buildings: 250000, contents: 50000 },
      property: { address: { line1: '1 Main St' }, propertyType: 'Villa' },
    };
    const contract = resolveEffectiveCoverageContract({
      productType: 'HOME',
      quoteData,
      cfg,
      storedSelection: {},
      programId: 'prog-home',
    });

    const view = buildCoverageOptionsView({
      manifest: adapter.getManifest(),
      groups: adapter.getEndorsementGroups(),
      templates: adapter.getEndorsementCatalog().filter((template) => template.program_code === contract.programCode),
      contract,
      activeInstances: [],
      quoteData,
    });

    expect(view.sections.length).toBeGreaterThan(0);
    expect(view.sections.some((section) => section.id === 'property')).toBe(true);
    expect(view.sections.flatMap((section) => section.items.map((item) => item.code))).toContain('HOME-BUILDINGS');
  });

  it('returns populated travel sections from the hand-authored backend catalog', () => {
    const adapter = ProductRegistry.getInstance().getAdapter('TRAVEL');
    if (!adapter) throw new Error('Travel adapter missing');
    const cfg = normalizeProgramMbeProductConfig(buildDefaultProgramMbeProductConfig({ productType: 'TRAVEL' }), {
      productType: 'TRAVEL',
    });
    const quoteData = {
      travellers: { coverType: 'couple', leadTravellerDOB: '1988-01-01' },
      trip: { planType: 'single_trip', destinations: ['Spain'], startDate: '2026-06-01', endDate: '2026-06-05' },
      quote: { selectedPlan: 'silver' },
    };
    const contract = resolveEffectiveCoverageContract({
      productType: 'TRAVEL',
      quoteData,
      cfg,
      storedSelection: {},
      programId: 'prog-travel',
    });

    const view = buildCoverageOptionsView({
      manifest: adapter.getManifest(),
      groups: adapter.getEndorsementGroups(),
      templates: adapter.getEndorsementCatalog().filter((template) => template.program_code === contract.programCode),
      contract,
      activeInstances: [],
      quoteData,
    });

    expect(view.sections.length).toBeGreaterThan(0);
    expect(view.sections.some((section) => section.id === 'core')).toBe(true);
    expect(view.sections.flatMap((section) => section.items.map((item) => item.code))).toContain('TRAVEL-BASE-COVER');
  });
});
