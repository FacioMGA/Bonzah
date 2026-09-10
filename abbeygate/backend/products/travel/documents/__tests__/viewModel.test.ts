import { describe, expect, it } from 'vitest';
import { buildTravelDocViewModel } from '../viewModel.js';
import type { DocPackContext } from '../../../shared/documents/genericDocPackGenerator.js';
import { travelGoldenFixtures } from '../../goldenFixtures.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';

// ADR-0019 — `buildTravelDocViewModel` reads `getTenantConfig()` for the
// tenant country/code/currency stamped on the schedule. Tests must run
// inside an ALS context. We use the CY fixture because all assertions in
// this file are CY-shaped (€, Cyprus address, CY legal pack).
const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);

function makeCtx(overrides: Partial<DocPackContext> = {}): DocPackContext {
  return {
    policy: {
      id: 'policy-1',
      policyNumber: 'ABOLV1000012',
      certificateNumber: null,
      productType: 'TRAVEL',
      inceptionDate: new Date('2026-05-07'),
      expiryDate: new Date('2027-05-07'),
      umr: 'B0000ABBEY/CY-TRAVEL/0001',
      binderId: null,
      policyHolder: {
        id: 'holder-1',
        name: 'Ada Travel',
        address: '1 Some Street',
        contact: JSON.stringify({ email: 'ada.travel@example.com', phone: '+35799111226' }),
      },
    },
    riskTransactionId: null,
    snapshot: {
      quoteData: travelGoldenFixtures.minimumValid,
      quoteResponse: {
        currency: 'EUR',
        primaryOption: {
          netPremium: 30,
          iptAmount: 0,
          adminFee: 10,
          annualPremium: 40,
          breakdown: { netPremium: 30, iptAmount: 0, adminFee: 10, grossPremium: 40 },
        },
      },
    },
    quoteData: travelGoldenFixtures.minimumValid,
    ...overrides,
  };
}

describe('buildTravelDocViewModel', () => {
  it('produces a flat record with the canonical fields used by the templates', () => {
    const vm = runInCY(() => buildTravelDocViewModel(makeCtx()));

    expect(vm.policyNumber).toBe('ABOLV1000012');
    expect(vm.umr).toContain('TRAVEL');
    expect((vm.policyHolder as Record<string, unknown>).name).toBe('Ada Travel');
    expect((vm.policyHolder as Record<string, unknown>).email).toBe('ada.travel@example.com');
    expect(vm.planLabel).toBe('Silver');
    expect(vm.tripTypeLabel).toBe('Single Trip');
    expect(vm.coverTypeLabel).toBe('Single Traveller');
    expect((vm.period as Record<string, unknown>).startDisplay).toMatch(/\d{2} \w{3} \d{4}/);
    expect((vm.premium as Record<string, unknown>).gross).toBe('40.00');
    expect(vm.currencySymbol).toBe('€');
    expect(vm.destinationsDisplay).toBe('Germany');
    expect((vm.policyHolder as Record<string, unknown>).addressDisplay).toBe('1 Travel Street, Nicosia, Cyprus');
    expect((vm.travellers as Record<string, unknown>).insuredPersons).toEqual([
      expect.objectContaining({
        name: 'Ada Travel',
        medicalScreeningRef: 'N/A',
        preExistingMedical: 'Excluded',
      }),
    ]);
    expect(vm.medicalNotice).toMatch(/pre-existing medical conditions are excluded/i);
  });

  // ADR-0056 — BDX-imported policies carry a declared-premium alignment line
  // (`kind: 'discount'`, negative amount) when the bordereau premium is below
  // the calculator's. The schedule must keep it: hiding it leaves the detail
  // rows summing above the total row.
  it('keeps negative discount lines in the schedule breakdown', () => {
    const ctx = makeCtx({
      snapshot: {
        quoteData: travelGoldenFixtures.minimumValid,
        quoteResponse: {
          currency: 'EUR',
          primaryOption: {
            annualPremium: 100,
            breakdown: {
              grossPremium: 100,
              lines: [
                { code: 'base', kind: 'base', label: 'Base premium', amount: 130 },
                { code: 'adjustment.bdxDeclaredAlignment', kind: 'discount', label: 'Bordereau declared premium alignment', amount: -40 },
                { code: 'fee.admin', kind: 'fee', label: 'Admin fee', amount: 10 },
                { code: 'zero.noise', kind: 'fee', label: 'Zero row', amount: 0 },
                { code: 'total', kind: 'total', label: 'Total', amount: 100 },
              ],
            },
          },
        },
      },
    });
    const vm = runInCY(() => buildTravelDocViewModel(ctx));
    type ScheduleLine = { code: string; label: string; amountDisplay: string; kind: string };
    const summary = vm.premiumSummary as { lines: ScheduleLine[] };
    const lines = summary.lines;
    expect(lines.map((line) => line.code)).toEqual([
      'base',
      'adjustment.bdxDeclaredAlignment',
      'fee.admin',
      'total',
    ]);
    const discount = lines.find((line) => line.code === 'adjustment.bdxDeclaredAlignment')!;
    expect(discount.kind).toBe('discount');
    expect(String(discount.amountDisplay)).toContain('40.00');
  });

  it('falls back gracefully when proposer / quoteResponse are missing', () => {
    const ctx = makeCtx({
      snapshot: {
        quoteData: travelGoldenFixtures.minimumValid,
        quoteResponse: {},
      },
    });
    const vm = runInCY(() => buildTravelDocViewModel(ctx));
    expect((vm.premium as Record<string, unknown>).gross).toBe('0.00');
    expect(vm.currency).toBe('EUR');
  });

  it('uses the canonical proposer name instead of the account policyHolder name', () => {
    const vm = runInCY(() => buildTravelDocViewModel(makeCtx({
      policy: {
        ...makeCtx().policy,
        policyHolder: {
          id: 'holder-1',
          name: 'Chris Efstathiou',
          address: 'Account address',
          contact: JSON.stringify({ email: 'effie@abbeygate.cy' }),
        },
      },
      quoteData: {
        ...travelGoldenFixtures.minimumValid,
        proposer: {
          ...(travelGoldenFixtures.minimumValid.proposer as Record<string, unknown>),
          firstName: 'Abbey',
          lastName: 'Jeanbean',
        },
      },
    })));

    expect((vm.policyHolder as Record<string, unknown>).name).toBe('Abbey Jeanbean');
    expect((vm.travellers as Record<string, unknown>).insuredPersons).toEqual([
      expect.objectContaining({ name: 'Abbey Jeanbean' }),
    ]);
  });

  it('renders destination area values as customer-facing labels', () => {
    const vm = runInCY(() => buildTravelDocViewModel(makeCtx({
      quoteData: {
        ...travelGoldenFixtures.minimumValid,
        trip: {
          ...travelGoldenFixtures.minimumValid.trip,
          destinations: ['worldwide_excluding_usa_canada'],
        },
      },
    })));
    expect(vm.destinationsDisplay).toBe('Worldwide excluding the USA and Canada');
  });

  it('includes every traveller from canonical DOB and details fields in the schedule model', () => {
    const vm = runInCY(() => buildTravelDocViewModel(makeCtx({
      quoteData: {
        ...travelGoldenFixtures.minimumValid,
        travellers: {
          coverType: 'family',
          travellerCount: 3,
          leadTravellerDOB: '1980-05-08',
          additionalTravellerDOBs: ['2012-03-04', '2014-07-09'],
          additionalTravellers: [
            { firstName: 'Ben', lastName: 'Travel', idType: 'passport', idNumber: 'P2' },
            { firstName: 'Cara', lastName: 'Travel', idType: 'id_card', idNumber: 'P3' },
          ],
        },
      },
    })));

    expect((vm.travellers as Record<string, unknown>).insuredPersons).toEqual([
      expect.objectContaining({ name: 'Ada Travel', dateOfBirthDisplay: '08/05/1980' }),
      expect.objectContaining({ name: 'Ben Travel', dateOfBirthDisplay: '04/03/2012' }),
      expect.objectContaining({ name: 'Cara Travel', dateOfBirthDisplay: '09/07/2014' }),
    ]);
  });
});
