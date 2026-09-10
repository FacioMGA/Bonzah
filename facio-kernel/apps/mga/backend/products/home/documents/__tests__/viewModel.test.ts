import { describe, expect, it } from 'vitest';
import { buildHomeDocViewModel } from '../viewModel.js';
import type { DocPackContext } from '../../../shared/documents/genericDocPackGenerator.js';
import { getTenantConfig, type TenantConfig } from '../../../../platform/tenant/tenantConfig.js';
import { homeGoldenFixtures } from '../../goldenFixtures.js';

function makeCtx(overrides: Partial<DocPackContext> = {}): DocPackContext {
  return {
    policy: {
      id: 'policy-1',
      policyNumber: 'ABOLV2000012',
      certificateNumber: null,
      productType: 'HOME',
      inceptionDate: new Date('2026-05-07'),
      expiryDate: new Date('2027-05-07'),
      umr: 'B0000ABBEY/CY-HOME/0001',
      binderId: null,
      policyHolder: {
        id: 'holder-1',
        name: 'Ada Home',
        address: '1 Home Street, Nicosia',
        contact: JSON.stringify({ email: 'ada.home@example.com', phone: '+35799111225' }),
      },
    },
    riskTransactionId: null,
    snapshot: {
      quoteData: homeGoldenFixtures.minimumValid,
      quoteResponse: {
        currency: 'EUR',
          primaryOption: {
            netPremium: 220,
            iptAmount: 0,
            adminFee: 18,
            annualPremium: 238,
            calculationTrace: { calculatorVersion: 'home-xlsx-2022@1.4.0' },
            breakdown: { netPremium: 220, iptAmount: 0, adminFee: 18, grossPremium: 238 },
        },
      },
    },
    quoteData: homeGoldenFixtures.minimumValid,
    ...overrides,
  };
}

describe('buildHomeDocViewModel', () => {
  it('shows the retained assistance fee and inclusion without applying a current pricing default', () => {
    const vm = buildHomeDocViewModel(makeCtx({ snapshot: { quoteResponse: { currency: 'EUR', primaryOption: { annualPremium: 293.39, breakdown: { netPremium: 263.39, iptAmount: 0, adminFee: 18, europAssistanceFee: 12, grossPremium: 293.39 } } } } }));
    expect(vm.premium).toMatchObject({ net: '263.39', ipt: '0.00', adminFee: '18.00', assistanceFee: '12.00', gross: '293.39' });
    expect(vm.premiumSummary).toMatchObject({ assistanceFeeDisplay: '12.00', totalPremiumDisplay: '293.39' });
    expect(vm.coverage).toMatchObject({ europAssistanceLabel: 'Yes' });
    const noFee = buildHomeDocViewModel(makeCtx({ snapshot: { quoteResponse: { currency: 'EUR', primaryOption: { annualPremium: 281.39, breakdown: { netPremium: 263.39, iptAmount: 0, adminFee: 18, europAssistanceFee: 0, grossPremium: 281.39 } } } } }));
    expect(noFee.coverage).toMatchObject({ europAssistanceLabel: 'No' });
    expect(noFee.premiumSummary).toMatchObject({ assistanceFeeDisplay: '' });
  });

  it('shows the CY €2,000 solar-panel cover when the stored draft was blank', () => {
    const baseCoverage = homeGoldenFixtures.minimumValid.coverage as { solarPanelCover?: number };
    const vm = buildHomeDocViewModel(makeCtx({
      quoteData: {
        ...homeGoldenFixtures.minimumValid,
        coverage: {
          ...baseCoverage,
          solarPanelCover: 0,
        },
      },
    }));

    const solarSection = (vm.sections as Array<{ code?: string; sumAssured?: string; sumAssuredAmount?: number }>)
      .find((section) => section.code === 'D');
    expect(solarSection).toMatchObject({ sumAssured: '€2,000.00', sumAssuredAmount: 2_000 });
  });

  it('preserves the recorded solar cover for documents rated before the new minimum', () => {
    const vm = buildHomeDocViewModel(makeCtx({
      quoteData: {
        ...homeGoldenFixtures.minimumValid,
        coverage: {
          ...(homeGoldenFixtures.minimumValid.coverage as { solarPanelCover?: number }),
          solarPanelCover: 0,
        },
      },
      snapshot: {
        quoteData: homeGoldenFixtures.minimumValid,
        quoteResponse: {
          currency: 'EUR',
          primaryOption: {
            netPremium: 220,
            iptAmount: 0,
            adminFee: 18,
            annualPremium: 238,
            calculationTrace: { calculatorVersion: 'home-xlsx-2022@1.3.0' },
            breakdown: { netPremium: 220, iptAmount: 0, adminFee: 18, grossPremium: 238 },
          },
        },
      },
    }));

    const solarSection = (vm.sections as Array<{ code?: string; sumAssured?: string }>)
      .find((section) => section.code === 'D');
    expect(solarSection?.sumAssured).toBe('Not Insured');
  });

  it('produces a flat record with the canonical fields used by the templates', () => {
    const vm = buildHomeDocViewModel(makeCtx());

    expect(vm.policyNumber).toBe('ABOLV2000012');
    expect(vm.umr).toContain('HOME');
    expect((vm.policyHolder as Record<string, unknown>).name).toBe('Ada Home');
    expect((vm.policyHolder as Record<string, unknown>).email).toBe('ada.home@example.com');
    expect((vm.property as Record<string, unknown>).typeLabel).toBe('Villa');
    expect((vm.property as Record<string, unknown>).addressDisplay).toContain('1 Home Street');
    expect((vm.property as Record<string, unknown>).permanentHomeLabel).toBe('Yes');
    expect((vm.usage as Record<string, unknown>).propertyUseLabel).toBe('For a Permanent Home');
    expect((vm.policyHolder as Record<string, unknown>).dateOfBirthDisplay).toMatch(/01 Jan 1980/);
    expect(vm.policyHolder).toMatchObject({ nationality: 'United Kingdom' });
    expect((vm.usage as Record<string, unknown>).businessUseLabel).toBe('No');
    expect((vm.security as Record<string, unknown>).doorsFiveLeverLocksLabel).toBe('Yes');
    expect((vm.coverage as Record<string, unknown>).buildingsDisplay).toMatch(/100,000|100\.000/);
    expect((vm.premium as Record<string, unknown>).gross).toBe('238.00');
    expect(vm.currencySymbol).toBe('€');
  });

  // ADR-0056 — home has no canonical breakdown lines, so the BDX
  // declared-premium alignment renders as its own schedule row. Without it
  // the flat net/IPT/admin components would sum to the calculator's premium
  // while the total shows the bordereau's declared premium.
  it('renders the BDX declared-premium alignment as its own premium row', () => {
    const vm = buildHomeDocViewModel(makeCtx({
      snapshot: {
        quoteData: homeGoldenFixtures.minimumValid,
        quoteResponse: {
          currency: 'EUR',
          primaryOption: {
            netPremium: 220,
            iptAmount: 0,
            adminFee: 18,
            annualPremium: 198,
            breakdown: { netPremium: 220, iptAmount: 0, adminFee: 18, grossPremium: 198, bdxDeclaredAlignment: -40 },
          },
        },
      },
    }));
    expect((vm.premium as { bdxAlignment?: string }).bdxAlignment).toBe('-40.00');
    expect((vm.premiumSummary as { bdxAlignmentAmountDisplay?: string }).bdxAlignmentAmountDisplay).toBe('-€40.00');
  });

  it('emits an empty alignment display when there is no declared-premium alignment', () => {
    const vm = buildHomeDocViewModel(makeCtx());
    expect((vm.premiumSummary as { bdxAlignmentAmountDisplay?: string }).bdxAlignmentAmountDisplay).toBe('');
  });

  it('maps secondary policy holders as joint proposers for schedules and statements', () => {
    const vm = buildHomeDocViewModel(makeCtx({
      quoteData: {
        ...homeGoldenFixtures.minimumValid,
        policyHolders: [{
          firstName: 'Grace',
          lastName: 'Home',
          email: 'grace.home@example.com',
          phone: '+35799111000',
          dateOfBirth: '1982-02-03',
          nationality: 'Cyprus',
          address: { line1: '2 Joint Street', city: 'Paphos', postcode: '8042', country: 'Cyprus' },
        }],
      },
    }));

    const holder = vm.policyHolder as Record<string, unknown>;
    const jointProposers = holder.jointProposers as Array<Record<string, unknown>>;
    const jointProposer = holder.jointProposer as Record<string, unknown>;
    expect(jointProposers).toHaveLength(1);
    expect(jointProposers[0]).toMatchObject({ name: 'Grace Home', email: 'grace.home@example.com' });
    expect(jointProposer.firstName).toBe('Grace');
    expect(String(jointProposer.addressMultiline)).toContain('2 Joint Street');
  });

  it('uses the canonical proposer name instead of the account policyHolder name', () => {
    const vm = buildHomeDocViewModel(makeCtx({
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
        ...homeGoldenFixtures.minimumValid,
        proposer: {
          ...(homeGoldenFixtures.minimumValid.proposer as Record<string, unknown>),
          firstName: 'Abbey',
          lastName: 'Jeanbean',
        },
      },
    }));

    expect((vm.policyHolder as Record<string, unknown>).name).toBe('Abbey Jeanbean');
  });

  it('uses selected home policy start date and mortgage details in document model', () => {
    const vm = buildHomeDocViewModel(
      makeCtx({
        policy: {
          ...makeCtx().policy,
          inceptionDate: new Date('2026-05-15'),
          expiryDate: new Date('2027-05-15'),
        },
        quoteData: {
          ...homeGoldenFixtures.minimumValid,
          policy: { startDate: '2026-05-25' },
          mortgage: {
            hasMortgage: true,
            lenderName: 'Bank of Cyprus',
            lenderAddress: '1 Bank Street, Paphos',
            lenderReference: 'MORT-123',
          },
        },
      }),
    );

    expect((vm.period as Record<string, unknown>).startNumeric).toBe('25/05/2026');
    expect(vm.mortgageLenderName).toBe('Bank of Cyprus');
    expect(vm.mortgageLenderAddress).toBe('1 Bank Street, Paphos');
    expect(vm.bankMortgageReference).toBe('MORT-123');
  });

  it('lists addons when coverage flags / amounts are set', () => {
    const baseCoverage = (homeGoldenFixtures.minimumValid.coverage ?? {}) as Record<string, unknown>;
    const vm = buildHomeDocViewModel(
      makeCtx({
        quoteData: {
          ...homeGoldenFixtures.minimumValid,
          coverage: {
            ...baseCoverage,
            accidentalDamageBuildings: true,
            allRiskJewellery: 5000,
            specifiedItems: [
              {
                description: 'Watch',
                make: 'Omega',
                model: 'Seamaster',
                serialNumber: 'ABC123',
                sumInsured: 3500,
              },
            ],
          },
        },
      }),
    );
    expect(vm.addonsLabels).toEqual(
      expect.arrayContaining([
        'Accidental Damage — Buildings',
        'High Risk Items',
      ]),
    );
    expect((vm.coverage as Record<string, unknown>).adBuildingsLabel).toBe('Yes');
    const sections = vm.sections as Array<Record<string, unknown>>;
    expect(sections[0].extraNotes).toContain('Accidental Damage — Included');
    expect(vm.specifiedItems).toEqual([
      {
        description: 'Watch · Omega · Seamaster · Serial: ABC123',
        sumInsuredDisplay: '€3,500.00',
      },
    ]);
  });

  it('auto-attaches the AB106 safe endorsement when specified high risk items exist', () => {
    const baseCoverage = (homeGoldenFixtures.minimumValid.coverage ?? {}) as Record<string, unknown>;
    const withHighRisk = buildHomeDocViewModel(
      makeCtx({
        quoteData: {
          ...homeGoldenFixtures.minimumValid,
          coverage: { ...baseCoverage, allRiskJewellery: 8000 },
        },
      }),
    );
    const endorsements = withHighRisk.endorsements as Array<Record<string, unknown>>;
    const codes = endorsements.map((e) => e.code);
    expect(codes).toContain('AB106');
    const ab106 = endorsements.find((e) => e.code === 'AB106');
    expect(String(ab106?.body)).toMatch(/locked safe or strongbox weighing over 100kgs/);
  });

  it('omits the AB106 safe endorsement when there are no specified high risk items', () => {
    const vm = buildHomeDocViewModel(makeCtx());
    const endorsements = vm.endorsements as Array<Record<string, unknown>>;
    expect(endorsements.map((e) => e.code)).not.toContain('AB106');
  });

  it('attaches AB105 to every holiday-home schedule', () => {
    const vm = buildHomeDocViewModel(makeCtx({
      quoteData: {
        ...homeGoldenFixtures.minimumValid,
        usage: { permanentHome: false },
      },
    }));
    const endorsements = vm.endorsements as Array<{ code: string; body: string }>;
    const ab105 = endorsements.find((endorsement) => endorsement.code === 'AB105');
    expect(ab105?.body).toMatch(/at least once every 14 days/);
  });

  it('does not attach AB105 to a permanent-home schedule', () => {
    const vm = buildHomeDocViewModel(makeCtx({
      quoteData: {
        ...homeGoldenFixtures.minimumValid,
        usage: { permanentHome: true },
      },
    }));
    const endorsements = vm.endorsements as Array<{ code: string }>;
    expect(endorsements.map((endorsement) => endorsement.code)).not.toContain('AB105');
  });

  it('projects a selected €350 excess onto Buildings and Contents', () => {
    const vm = buildHomeDocViewModel(makeCtx({
      quoteData: {
        ...homeGoldenFixtures.minimumValid,
        risk: {
          ...homeGoldenFixtures.minimumValid.risk,
          increasedExcess: '350 XS',
        },
      },
    }));
    const sections = vm.sections as Array<{ code: string; excessNote?: string; excessLabel?: string }>;
    expect(sections.find((section) => section.code === 'A')?.excessNote).toMatch(/Euro 350.00 excess/);
    expect(sections.find((section) => section.code === 'B')?.excessLabel).toBe('€350 excess');
  });

  // PT go-live: the Portugal Home binder does not offer subsidence/heave/
  // landslip, so every PT schedule must carry the AB99 Deletion of Cover
  // endorsement. Cyprus schedules must NOT carry it.
  it('attaches the AB99 subsidence deletion endorsement on Portugal schedules only', async () => {
    const { runWithOperatingTenant } = await import('../../../../platform/tenant/tenantAls.js');
    const ptTenant: TenantConfig = {
      runtimeSettings: getTenantConfig().runtimeSettings,
      id: 'tenant-pt-test',
      tenantSlug: 'abbeygate-pt',
      countryCode: 'PT',
      country: 'Portugal',
      currency: 'EUR',
      ipt: { flatFee: 0 },
      adminFee: 10,
      publicBaseUrl: 'https://pt.abbeygate.com',
      fromEmail: 'pt@example.com',
      brandLogo: { white: 'https://example.com/white.png', blue: 'https://example.com/blue.png' },
      legalPack: 'pt',
    };
    const ptVm = await runWithOperatingTenant(ptTenant, async () =>
      buildHomeDocViewModel(makeCtx()),
    );
    const ptEndorsements = ptVm.endorsements as Array<{ code: string; body: string }>;
    const ab99 = ptEndorsements.find((e) => e.code === 'AB99');
    expect(ab99).toBeDefined();
    expect(String(ab99?.body)).toMatch(/Subsidence or Heave .* hereby deleted from the policy wording/);

    const cyVm = buildHomeDocViewModel(makeCtx());
    const cyEndorsements = cyVm.endorsements as Array<{ code: string; body: string }>;
    expect(cyEndorsements.map((e) => e.code)).not.toContain('AB99');
  });

  it('uses coverage-selection only for MBE-only document labels', () => {
    const vm = buildHomeDocViewModel(makeCtx());
    expect(vm.addonsLabels).not.toContain('Europ Assistance Helpline');

    const selected = buildHomeDocViewModel(
      makeCtx({
        snapshot: {
          quoteData: homeGoldenFixtures.minimumValid,
          quoteResponse: {
            currency: 'EUR',
            primaryOption: {
              netPremium: 220,
              iptAmount: 0,
              adminFee: 18,
              annualPremium: 238,
              breakdown: { netPremium: 220, iptAmount: 0, adminFee: 18, grossPremium: 238 },
            },
          },
          coverageSelection: {
            selected: {
              'HOME-ACC-DAMAGE-BUILDINGS': true,
              'HOME-ACC-DAMAGE-CONTENTS': true,
              'HOME-EUROP-ASSISTANCE': true,
            },
          },
        },
      }),
    );
    expect(selected.addonsLabels).toContain('Europ Assistance Helpline');
    expect((selected.coverage as Record<string, unknown>).europAssistanceLabel).toBe('Yes');
    expect((selected.coverage as Record<string, unknown>).adBuildingsLabel).toBe('No');
    expect((selected.coverage as Record<string, unknown>).adContentsLabel).toBe('No');
  });

  it('uses proposer address as insured premises when property is same as proposer', () => {
    const vm = buildHomeDocViewModel(
      makeCtx({
        quoteData: {
          ...homeGoldenFixtures.minimumValid,
          property: {
            ...(homeGoldenFixtures.minimumValid.property as Record<string, unknown>),
            sameAsProposer: true,
            address: { country: 'Cyprus' },
          },
          proposer: {
            ...(homeGoldenFixtures.minimumValid.proposer as Record<string, unknown>),
            address: {
              line1: 'Kamares',
              city: 'Pyrga',
              postcode: '7648',
              country: 'Cyprus',
            },
          },
        },
      }),
    );

    expect((vm.property as Record<string, unknown>).addressMultiline).toBe('Kamares\nPyrga\n7648\nCyprus');
  });

  it('renders holiday-home type and additional security details', () => {
    const vm = buildHomeDocViewModel(
      makeCtx({
        quoteData: {
          ...homeGoldenFixtures.minimumValid,
          property: {
            ...(homeGoldenFixtures.minimumValid.property as Record<string, unknown>),
            propertyType: 'Static Caravan',
            permanentHome: false,
          },
          usage: {
            ...(homeGoldenFixtures.minimumValid.usage as Record<string, unknown>),
            permanentHome: false,
          },
          security: {
            ...(homeGoldenFixtures.minimumValid.security as Record<string, unknown>),
            additionalSecurity: true,
            additionalSecurityDescription: 'CCTV installed',
          },
        },
      }),
    );

    expect((vm.property as Record<string, unknown>).typeLabel).toBe('Static Caravan');
    expect((vm.usage as Record<string, unknown>).propertyUseLabel).toBe('For a Holiday Home');
    expect((vm.security as Record<string, unknown>).additionalSecurityDescription).toBe('CCTV installed');
  });
});
