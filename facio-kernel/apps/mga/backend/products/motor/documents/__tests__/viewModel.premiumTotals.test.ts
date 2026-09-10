import { describe, expect, it } from 'vitest';
import { buildMotorDocViewModel as buildMotorViewModel } from '../viewModel.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';
const buildMotorDocViewModel = (...args: Parameters<typeof buildMotorViewModel>) => runWithOperatingTenant(getTenantFixtures().find(tenant => tenant.countryCode === 'CY')!, () => buildMotorViewModel(...args));
import { registerAllProducts } from '../../../registerProducts.js';
import { CV1020_SANCTIONS_CLAUSE, CV1020_HEADING_LINE } from '../../../shared/documents/sanctionsClause.js';

registerAllProducts();

describe('buildMotorDocViewModel premium totals', () => {
  it('prefers the corrected policy/binder UMR over stale bound snapshots', () => {
    const vm = buildMotorDocViewModel({
      policy: {
        policyNumber: 'ABOLV1000020',
        inceptionDate: new Date('2026-03-01T00:00:00.000Z'),
        expiryDate: new Date('2027-03-01T00:00:00.000Z'),
        policyHolder: { name: 'Test User' },
        binder: { agreementNumber: 'ABBEYGATE0125-2026', umr: 'B176026EEA6152' },
        umr: 'B176026EEA6152',
      },
      snap: {
        umr: 'B6081 ABBEYGATE0125-2026',
        quoteData: {
          proposer: {
            address: { line1: 'Some street', city: 'Nicosia', postcode: '1000', country: 'Cyprus' },
          },
          countryOfRegistration: 'CY',
        },
        quoteResponse: { primaryOption: { costDetails: { subtotalNetPremium: 0, totalPremium: 0 } } },
      },
      activeEndorsements: [],
      appliedEndorsements: [],
      mbeSections: { coverages: [], conditions: [], assistance: null, premiumRows: [] },
      normalizedMbeCfg: {},
      greenCardSerial: null,
      brand: { brokerAddressMultiline: '' },
      assetsBasePath: 'file:///tmp',
    });

    expect(vm.umr).toBe('B176026EEA6152');
  });

  it('uses the canonical proposer name instead of the account policyHolder name', () => {
    const vm = buildMotorDocViewModel({
      policy: {
        policyNumber: 'ABOLV1000016',
        inceptionDate: new Date('2026-03-01T00:00:00.000Z'),
        expiryDate: new Date('2027-03-01T00:00:00.000Z'),
        policyHolder: { name: 'Chris Efstathiou' },
        binder: { agreementNumber: 'ABBEYGATE0125' },
      },
      snap: {
        quoteData: {
          proposer: {
            firstName: 'Abbey',
            lastName: 'Jeanbean',
            address: { line1: 'Some street', city: 'Nicosia', postcode: '1000', country: 'Cyprus' },
          },
          countryOfRegistration: 'CY',
        },
        quoteResponse: { primaryOption: { costDetails: { subtotalNetPremium: 0, totalPremium: 0 } } },
      },
      activeEndorsements: [],
      appliedEndorsements: [],
      mbeSections: { coverages: [], conditions: [], assistance: null, premiumRows: [] },
      normalizedMbeCfg: {},
      greenCardSerial: null,
      brand: { brokerAddressMultiline: '' },
      assetsBasePath: 'file:///tmp',
    });

    expect((vm.insured as Record<string, unknown>).name).toBe('Abbey Jeanbean');
    expect((vm.drivers as Record<string, unknown>).named_csv).toBe('Abbey Jeanbean');
    expect(((vm.statement as Record<string, unknown>).drivers as Array<Record<string, unknown>>)[0]?.full_name).toBe('Abbey Jeanbean');
  });

  it('maps secondary policy holders as additional policyholder document rows', () => {
    const vm = buildMotorDocViewModel({
      policy: {
        policyNumber: 'ABOLV1000017',
        inceptionDate: new Date('2026-03-01T00:00:00.000Z'),
        expiryDate: new Date('2027-03-01T00:00:00.000Z'),
        policyHolder: { name: 'Test User' },
        binder: { agreementNumber: 'ABBEYGATE0125' },
      },
      snap: {
        quoteData: {
          proposer: {
            address: { line1: 'Some street', city: 'Nicosia', postcode: '1000', country: 'Cyprus' },
          },
          policyHolders: [{
            firstName: 'Grace',
            lastName: 'Motor',
            email: 'grace.motor@example.com',
            phone: '+35799111000',
            dateOfBirth: '1982-02-03',
            address: { line1: '2 Joint Street', city: 'Paphos', postcode: '8042', country: 'Cyprus' },
          }],
          countryOfRegistration: 'CY',
        },
        quoteResponse: { primaryOption: { costDetails: { subtotalNetPremium: 0, totalPremium: 0 } } },
      },
      activeEndorsements: [],
      appliedEndorsements: [],
      mbeSections: { coverages: [], conditions: [], assistance: null, premiumRows: [] },
      normalizedMbeCfg: {},
      greenCardSerial: null,
      brand: { brokerAddressMultiline: '' },
      assetsBasePath: 'file:///tmp',
    });

    const insured = vm.insured as Record<string, unknown>;
    const statement = vm.statement as Record<string, unknown>;
    expect(insured.additionalPolicyHolders).toEqual([
      expect.objectContaining({ name: 'Grace Motor', email: 'grace.motor@example.com' }),
    ]);
    expect(statement.additionalPolicyHolders).toEqual([
      expect.objectContaining({ name: 'Grace Motor', date_of_birth: '03/02/1982' }),
    ]);
  });

  it('does not treat windscreen as an add-on when quote total already includes it in core premium', () => {
    const vm = buildMotorDocViewModel({
      policy: {
        policyNumber: 'ABOLV1000018',
        inceptionDate: new Date('2026-03-01T00:00:00.000Z'),
        expiryDate: new Date('2027-03-01T00:00:00.000Z'),
        policyHolder: { name: 'Test User' },
        binder: { agreementNumber: 'ABBEYGATE0125' },
      },
      snap: {
        quoteData: {
          proposer: {
            address: { line1: 'Some street', city: 'Nicosia', postcode: '1000', country: 'Cyprus' },
          },
          countryOfRegistration: 'CY',
        },
        quoteResponse: {
          primaryOption: {
            costDetails: {
              subtotalNetPremium: 634.41,
              mifSurcharge: 9.0,
              stampDuty: 0,
              totalPremium: 729.41,
            },
          },
        },
      },
      activeEndorsements: [],
      appliedEndorsements: [],
      mbeSections: {
        coverages: [],
        conditions: [],
        assistance: null,
        premiumRows: [
          { itemCode: 'Windscreen', amount: '25.00' },
          { itemCode: 'Breakdown & ULR Cover', amount: '86.00' },
        ],
      },
      normalizedMbeCfg: {},
      greenCardSerial: null,
      brand: {
        brokerAddressMultiline: '',
      },
      assetsBasePath: 'file:///tmp',
    });

    const premiumBreakdown = vm.premiumBreakdown as Record<string, unknown>;
    const premium = vm.premium as Record<string, unknown>;
    const totals = vm.totals as Record<string, unknown>;
    expect(premiumBreakdown.total).toBe('643.41');
    expect(totals.schedule_total_eur).toBe('643.41');
    expect((premium.addOnRows as Array<{ itemCode: string }>)).toHaveLength(1);
    expect(((premium.addOnRows as Array<{ itemCode: string }>)[0] || {}).itemCode).toBe('Breakdown & ULR Cover');
    expect(totals.add_ons_total_eur).toBe('86.00');
    expect(totals.total_payable_eur).toBe('729.41');
    expect(totals.total_paid_to_mga_eur).toBe('729.41');
  });

  it('uses calculation trace add-ons for totals and rows when available', () => {
    const vm = buildMotorDocViewModel({
      policy: {
        policyNumber: 'ABOLV1000019',
        inceptionDate: new Date('2026-03-01T00:00:00.000Z'),
        expiryDate: new Date('2027-03-01T00:00:00.000Z'),
        policyHolder: { name: 'Test User' },
        binder: { agreementNumber: 'ABBEYGATE0125' },
      },
      snap: {
        quoteData: {
          proposer: {
            address: { line1: 'Some street', city: 'Nicosia', postcode: '1000', country: 'Cyprus' },
          },
          countryOfRegistration: 'CY',
        },
        quoteResponse: {
          primaryOption: {
            costDetails: {
              subtotalNetPremium: 343.73,
              mifSurcharge: 9.0,
              stampDuty: 0,
              totalPremium: 518.73,
            },
            calculationTrace: {
              steps: [
                { id: 'endorsement.premium.CV 24', name: 'Windscreen', amount: 25 },
                { id: 'endorsement.premium.CV 172', name: 'NCB Protection', amount: 45 },
                { id: 'endorsement.premium.COV-ROADSIDE', name: 'Breakdown & ULR Cover', amount: 86 },
                { id: 'endorsement.premium.COV-ROADSIDE-VIP', name: 'VIP Roadside Upgrade', amount: 35 },
              ],
            },
          },
        },
      },
      activeEndorsements: [],
      appliedEndorsements: [],
      mbeSections: {
        coverages: [],
        conditions: [],
        assistance: null,
        premiumRows: [
          { itemCode: 'Windscreen', amount: '25.00' },
          { itemCode: 'Breakdown & ULR Cover', amount: '86.00' },
        ],
      },
      normalizedMbeCfg: {},
      greenCardSerial: null,
      brand: {
        brokerAddressMultiline: '',
      },
      assetsBasePath: 'file:///tmp',
    });

    const premium = vm.premium as Record<string, unknown>;
    const addOnRows = (premium.addOnRows as Array<{ itemCode: string; amount: string }>) || [];
    const totals = vm.totals as Record<string, unknown>;
    expect(addOnRows).toHaveLength(3);
    expect(totals.schedule_total_eur).toBe('352.73');
    expect(totals.add_ons_total_eur).toBe('166.00');
    expect(totals.total_payable_eur).toBe('518.73');
    expect(totals.total_paid_to_mga_eur).toBe('518.73');
  });

  it('maps schedule notes and only exposes separate-line pricing adjustments to schedule output', () => {
    const vm = buildMotorDocViewModel({
      policy: {
        policyNumber: 'ABOLV1000020',
        inceptionDate: new Date('2026-03-01T00:00:00.000Z'),
        expiryDate: new Date('2027-03-01T00:00:00.000Z'),
        policyHolder: { name: 'Test User' },
        binder: { agreementNumber: 'ABBEYGATE0125' },
      },
      snap: {
        quoteData: {
          proposer: {
            address: { line1: 'Some street', city: 'Nicosia', postcode: '1000', country: 'Cyprus' },
          },
          countryOfRegistration: 'CY',
          uwAdjustments: [
            {
              id: 'adj-separate',
              lineType: 'pricing',
              name: 'UW loading shown',
              type: 'loading',
              mode: 'amount',
              value: 15,
              reasonText: 'High-performance vehicle',
              schedulePresentation: 'separate_line',
            },
            {
              id: 'adj-inherent',
              lineType: 'pricing',
              name: 'UW discount hidden',
              type: 'discount',
              mode: 'amount',
              value: 5,
              reasonText: 'Retention support',
              schedulePresentation: 'inherent',
            },
            {
              id: 'note-1',
              lineType: 'schedule_note',
              category: 'EXCLUSION',
              text: 'No cover during track events.',
            },
          ],
        },
        quoteResponse: {
          primaryOption: {
            costDetails: {
              subtotalNetPremium: 300,
              mifSurcharge: 9.0,
              stampDuty: 0,
              totalPremium: 309,
            },
            calculationTrace: {
              steps: [
                { id: 'uw.adjustment.0', amount: 15 },
                { id: 'uw.adjustment.1', amount: -5 },
              ],
            },
          },
        },
      },
      activeEndorsements: [],
      appliedEndorsements: [],
      mbeSections: {
        coverages: [],
        conditions: [],
        assistance: null,
        premiumRows: [],
      },
      normalizedMbeCfg: {},
      greenCardSerial: null,
      brand: {
        brokerAddressMultiline: '',
      },
      assetsBasePath: 'file:///tmp',
    });

    const endorsements = (vm.endorsements as Array<Record<string, unknown>>) || [];
    const scheduleNotes = (vm.scheduleNotes as Array<Record<string, unknown>>) || [];

    expect(endorsements.some((e) => String(e.headingLine || '').includes('UW loading shown'))).toBe(true);
    expect(endorsements.some((e) => String(e.headingLine || '').includes('UW discount hidden'))).toBe(false);
    expect(scheduleNotes).toHaveLength(1);
    expect(String(scheduleNotes[0]?.category || '')).toBe('EXCLUSION');
    expect(String(scheduleNotes[0]?.text || '')).toContain('track events');
  });

  it('prints the CV1020 sanctions clause and drops the legacy CV 1028 exclusion', () => {
    const vm = buildMotorDocViewModel({
      policy: {
        policyNumber: 'ABOLV1000021',
        inceptionDate: new Date('2026-03-01T00:00:00.000Z'),
        expiryDate: new Date('2027-03-01T00:00:00.000Z'),
        policyHolder: { name: 'Test User' },
        binder: { agreementNumber: 'ABBEYGATE0125' },
      },
      snap: {
        quoteData: {
          proposer: {
            address: { line1: 'Some street', city: 'Nicosia', postcode: '1000', country: 'Cyprus' },
          },
          countryOfRegistration: 'CY',
        },
        quoteResponse: { primaryOption: { costDetails: { subtotalNetPremium: 0, totalPremium: 0 } } },
      },
      activeEndorsements: [],
      // The legacy motor sanctions exclusion is applied; CV1020 must supersede it.
      appliedEndorsements: [{ code: 'CV 1028' }],
      mbeSections: { coverages: [], conditions: [], assistance: null, premiumRows: [] },
      normalizedMbeCfg: {},
      greenCardSerial: null,
      brand: { brokerAddressMultiline: '' },
      assetsBasePath: 'file:///tmp',
    });

    // Mapped-type "loose row" — structurally an any-shaped JSON object without
    // tripping the diff type-laundering guard's indexed-record pattern.
    type LooseRow = { [k in string]?: unknown };
    const endorsements = (vm.endorsements as Array<LooseRow>) || [];
    const codes = endorsements.map((e) => String(e.templateCode || e.code || ''));

    expect(codes).toContain(CV1020_SANCTIONS_CLAUSE.code);
    // No competing sanctions clause: the legacy CV 1028 template is dropped.
    expect(codes.some((c) => c.replace(/\s+/g, '').toUpperCase() === 'CV1028')).toBe(false);

    const cv1020 = endorsements.find((e) => String(e.templateCode || e.code) === CV1020_SANCTIONS_CLAUSE.code)!;
    expect(String(cv1020.headingLine)).toBe(CV1020_HEADING_LINE);
    expect(CV1020_HEADING_LINE).toContain('Sanctions Limitation Clause');
    expect(String(cv1020.description)).toContain('United Nations resolutions');
  });
});

