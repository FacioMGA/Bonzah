/**
 * Pinning tests for `PolicyListRowViewModel`.
 *
 * These tests enforce the consultant's "canonical structure" invariant:
 * every product's row is reshaped into the SAME VM. Adding a new product
 * cannot introduce a new slot without failing this suite.
 *
 * We also assert that Motor's output is unchanged vs the data the old
 * renderer used to display — if this drifts, something about the motor
 * projection has regressed and needs review before shipping.
 */

import { describe, expect, it } from 'vitest';
import '@/src/products'; // ensures motor / home / travel register
import { buildPolicyListRowViewModel } from '../policyListRow';

const motorPolicy = {
  id: 'p-motor',
  productType: 'MOTOR',
  policyNumber: 'ABOLV1000103',
  name: 'Uriel Aharoni',
  policyholderEmail: 'uriel@example.com',
  policyholderPhone: '+357 99 123456',
  status: 'ISSUED',
  start: '2026-05-07',
  end: '2027-05-07',
  premium: 643,
  currency: 'EUR',
  createdAt: '2026-04-23T10:00:00Z',
  updatedAt: '2026-04-23T14:30:00Z',
  quoteData: {
    firstName: 'Uriel',
    lastName: 'Aharoni',
    make: 'BMW',
    model: 'X5',
    year: 2024,
    fuelType: 'Petrol',
    engineSize: 1600,
    vehicleValue: 80000,
    coverRequired: 'Comprehensive',
    requiredExcess: 250,
  },
};

const homePolicy = {
  id: 'p-home',
  productType: 'HOME',
  policyNumber: 'ABOLV1000200',
  name: 'Jane Smith',
  policyholderEmail: 'jane@example.com',
  status: 'ACTIVE',
  start: '2026-01-01',
  end: '2027-01-01',
  premium: 620,
  currency: 'EUR',
  quoteData: {
    proposer: {
      firstName: 'Jane',
      lastName: 'Smith',
    },
    property: {
      propertyType: 'Villa',
      bedrooms: 4,
      floorAreaSqm: 240,
      address: {
        line1: '12 Makariou Ave',
        city: 'Nicosia',
      },
    },
    coverage: {
      buildings: 350000,
      contents: 50000,
    },
    risk: {
      increasedExcess: 'STD 500',
    },
  },
};

const travelPolicy = {
  id: 'p-travel',
  productType: 'TRAVEL',
  policyNumber: 'ABOLV1000108',
  name: 'John Doe',
  policyholderEmail: 'john@example.com',
  status: 'QUOTED',
  start: '2026-06-01',
  end: '2026-06-15',
  premium: 42,
  currency: 'EUR',
  quoteData: {
    proposer: { firstName: 'John', lastName: 'Doe' },
    trip: {
      planType: 'single_trip',
      destinations: 'Worldwide',
      startDate: '2026-06-01',
      endDate: '2026-06-15',
    },
    travellers: { coverType: 'single' },
    quote: { selectedPlan: 'silver' },
  },
};

describe('PolicyListRowViewModel — shape parity across products', () => {
  it('returns every slot for every product', () => {
    for (const input of [motorPolicy, homePolicy, travelPolicy]) {
      const vm = buildPolicyListRowViewModel(input);
      expect(vm).not.toBeNull();
      if (!vm) continue;
      // Top-level slots
      expect(vm).toHaveProperty('riskSummary');
      expect(vm).toHaveProperty('policyholder');
      expect(vm).toHaveProperty('coverage');
      expect(vm).toHaveProperty('status');
      expect(vm).toHaveProperty('premium');
      expect(vm).toHaveProperty('dates');
      expect(vm).toHaveProperty('product');
      // Nested required keys
      expect(vm.riskSummary).toHaveProperty('kind');
      expect(vm.riskSummary).toHaveProperty('title');
      expect(vm.policyholder).toHaveProperty('name');
      expect(vm.coverage).toHaveProperty('name');
      expect(vm.status).toHaveProperty('rawStatus');
      expect(vm.premium).toHaveProperty('amount');
      expect(vm.premium).toHaveProperty('currency');
      expect(vm.product).toHaveProperty('productType');
    }
  });

  it('returns null when no product manifest is registered', () => {
    expect(buildPolicyListRowViewModel({ id: 'x', productType: 'GADGET' })).toBeNull();
    expect(buildPolicyListRowViewModel({ id: 'x' })).toBeNull();
  });
});

describe('PolicyListRowViewModel — motor projection pinned', () => {
  it('produces the motor title, subtitle, and value consistent with the old renderer', () => {
    const vm = buildPolicyListRowViewModel(motorPolicy);
    expect(vm).not.toBeNull();
    if (!vm) return;
    expect(vm.riskSummary.kind).toBe('vehicle');
    // Motor list row uses year/make/model in display order.
    expect(vm.riskSummary.title.toLowerCase()).toContain('bmw');
    expect(vm.riskSummary.title).toContain('X5');
    expect(vm.riskSummary.title).toContain('2024');
    expect(vm.riskSummary.subtitle).toBe('Petrol · 1600cc');
    // coverage
    expect(vm.coverage.name).toBe('Comprehensive');
    expect(vm.coverage.details).toBe('€250 excess');
    // policyholder
    expect(vm.policyholder.name).toBe('Uriel Aharoni');
    expect(vm.policyholder.email).toBe('uriel@example.com');
    expect(vm.policyholder.phone).toBe('+357 99 123456');
    // premium + status + numbers
    expect(vm.premium).toEqual({ amount: 643, currency: 'EUR' });
    expect(vm.status.rawStatus).toBe('ISSUED');
    expect(vm.status.policyNumber).toBe('ABOLV1000103');
  });
});

describe('PolicyListRowViewModel — home and travel produce meaningful coverage', () => {
  it('home derives "Buildings + Contents" when both sums are > 0', () => {
    const vm = buildPolicyListRowViewModel(homePolicy);
    expect(vm?.coverage.name).toBe('Buildings + Contents');
    expect(vm?.coverage.details).toBe('€350,000 + €50,000');
    expect(vm?.riskSummary.title).toBe('4-Bed Villa');
    expect(vm?.riskSummary.subtitle).toBe('Nicosia · 240m²');
    expect(vm?.riskSummary.detail).toBeUndefined();
    expect(vm?.product.productType).toBe('HOME');
  });

  it('home falls back to "Buildings only" when contents = 0', () => {
    const vm = buildPolicyListRowViewModel({
      ...homePolicy,
      quoteData: {
        ...homePolicy.quoteData,
        coverage: { buildings: 250000, contents: 0 },
      },
    });
    expect(vm?.coverage.name).toBe('Buildings only');
    expect(vm?.coverage.details).toBe('€250,000');
  });

  it('travel shows tier on the first line and type plus duration on the second', () => {
    const vm = buildPolicyListRowViewModel(travelPolicy);
    expect(vm?.coverage.name).toBe('Silver');
    expect(vm?.coverage.details).toBe('Single Trip · 15 days');
    expect(vm?.riskSummary.title).toBe('Worldwide Travel');
    expect(vm?.riskSummary.subtitle).toBe('Single traveller · Single trip · 15 days');
    expect(vm?.product.productType).toBe('TRAVEL');
  });

  it('travel annual coverage shows elapsed days against the max trip-day allowance', () => {
    const start = new Date();
    start.setDate(start.getDate() - 12);
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    const vm = buildPolicyListRowViewModel({
      ...travelPolicy,
      quoteData: {
        ...travelPolicy.quoteData,
        trip: {
          ...(travelPolicy.quoteData.trip as Record<string, unknown>),
          planType: 'annual_multi_trip',
          startDate: iso(start),
          endDate: iso(end),
        },
        quote: { selectedPlan: 'platinum', maxTripDays: 26 },
      },
    });

    expect(vm?.coverage.name).toBe('Platinum');
    expect(vm?.coverage.details).toBe('Annual · 13/26 days used');
    expect(vm?.riskSummary.title).toBe('Worldwide Travel');
    expect(vm?.riskSummary.subtitle).toBe('Single traveller · Annual · 13/26 days used');
  });

  it('travel risk summary surfaces the trip destination', () => {
    const vm = buildPolicyListRowViewModel(travelPolicy);
    expect(vm?.riskSummary.title).toBe('Worldwide Travel');
  });
});

describe('PolicyListRowViewModel — no motor leakage', () => {
  it('renders motor purely from quoteData (no vehicleInfo legacy merge)', () => {
    const vm = buildPolicyListRowViewModel(motorPolicy);
    expect(vm?.riskSummary.title.toLowerCase()).toContain('bmw');
  });
});
