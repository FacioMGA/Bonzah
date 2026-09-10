import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationRegistry, validateForContext } from '@facio/validation/frontend';
import { homeManifest } from '../manifest.js';
import { homeValidationProfile } from '../profile.js';

beforeEach(() => {
  ValidationRegistry.register(homeValidationProfile);
});

afterEach(() => {
  ValidationRegistry._resetForTests();
});

describe('home validation profile', () => {
  it('renders every required profile field that can block BO underwriting', () => {
    const manifestPaths = new Set(
      homeManifest.questionnaire.sections.flatMap((section) => section.fields.map((field) => field.path)),
    );
    const missing = Object.entries(homeValidationProfile.fields)
      .filter(([, field]) => field.required === true && field.audience !== 'customer')
      .map(([path]) => path)
      .filter((path) => !manifestPaths.has(path));

    expect(missing).toEqual([]);
  });

  it('renders every lifecycle-stage field visible to BO underwriting', () => {
    const manifestPaths = new Set(
      homeManifest.questionnaire.sections.flatMap((section) => section.fields.map((field) => field.path)),
    );
    const stageFields = [
      ...homeValidationProfile.stages.bind.fields,
      ...homeValidationProfile.stages.issuance.fields,
    ];
    const missing = Array.from(new Set(stageFields))
      .filter((path) => homeValidationProfile.fields[path]?.audience !== 'customer')
      .filter((path) => !manifestPaths.has(path));

    expect(missing).toEqual([]);
  });

  it('does not mark buildings and contents as individually required in the manifest', () => {
    const sumsInsured = homeManifest.questionnaire.sections.find((section) => section.id === 'sums-insured');
    const buildings = sumsInsured?.fields.find((field) => field.path === 'coverage.buildings');
    const contents = sumsInsured?.fields.find((field) => field.path === 'coverage.contents');

    expect(buildings?.required).toBeUndefined();
    expect(contents?.required).toBeUndefined();
  });

  it('maps policy start date into the policy period used by sessions and documents', () => {
    const coverage = homeManifest.listColumns.coverage;
    const data = { policy: { startDate: '2026-05-20' } };

    expect(coverage.buildStartDate?.(data)).toBe('2026-05-20');
    expect(coverage.buildEndDate?.(data)).toBe('2027-05-20');
  });

  it('flags every missing required field in policy-holder step', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: {},
    });
    expect(errors['proposer.firstName']).toBeDefined();
    expect(errors['proposer.lastName']).toBeDefined();
    expect(errors['proposer.email']).toBeDefined();
    expect(errors['proposer.phone']).toBeDefined();
    expect(errors['proposer.dateOfBirth']).toBeDefined();
    expect(errors['proposer.address.line1']).toBeDefined();
    expect(errors['proposer.address.city']).toBeDefined();
  });

  it('rejects malformed email and future DOB with specific messages', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: {
        proposer: {
          firstName: 'Uriel',
          lastName: 'Aharoni',
          email: 'not-an-email',
          phone: '+44 20 7946 0010',
          dateOfBirth: future.toISOString().slice(0, 10),
          nationality: 'United Kingdom',
          address: { line1: 'Somewhere', city: 'Nicosia', country: 'Cyprus', postcode: '1010' },
        },
      },
    });
    expect(errors['proposer.email']).toMatch(/valid email/i);
    expect(errors['proposer.dateOfBirth']).toBe('Date of birth cannot be in the future');
  });

  it('enforces Portugal postcode format via cross-field refinement', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: {
        proposer: {
          firstName: 'Ivan',
          lastName: 'Silva',
          email: 'ivan@example.com',
          phone: '+351 21 000 0000',
          dateOfBirth: '1985-05-15',
          nationality: 'Portugal',
          address: { line1: 'Rua Test', city: 'Lisbon', country: 'Portugal', postcode: '12345' },
        },
      },
    });
    expect(errors['proposer.address.postcode']).toMatch(/1234-567/);
  });

  it('passes with fully valid policy-holder data', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: {
        proposer: {
          firstName: 'Uriel',
          lastName: 'Aharoni',
          email: 'u@example.com',
          phone: '+44 20 7946 0010',
          dateOfBirth: '1985-05-15',
          nationality: 'United Kingdom',
          domicileCountry: 'Cyprus',
          address: { line1: 'Somewhere', city: 'Nicosia', country: 'Cyprus', postcode: '1010' },
        },
      },
    });
    expect(errors).toEqual({});
  });

  it('sums-insured allows contents-only policies', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'sums-insured' },
      actor: 'customer',
      data: {
        coverage: { buildings: 0, contents: 50000 },
        usage: { permanentHome: true, businessUse: false, rentedOut: false },
      },
    });
    expect(errors['coverage.buildings']).toBeUndefined();
    expect(errors['coverage.contents']).toBeUndefined();
  });

  it('sums-insured rejects rows with no buildings or contents cover', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'sums-insured' },
      actor: 'customer',
      data: {
        coverage: { buildings: 0, contents: 0 },
        usage: { permanentHome: true, businessUse: false, rentedOut: false },
      },
    });
    expect(errors['coverage.buildings']).toBe('Missing home buildings or contents sum insured');
    expect(errors['coverage.contents']).toBeUndefined();
  });

  it('requires the property address only when it differs from the proposer address', () => {
    const missing = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'property' },
      actor: 'customer',
      data: {
        property: {
          sameAsProposer: false,
          propertyType: 'Villa',
          bedrooms: 3,
          floorAreaSqm: 120,
          landAreaSqm: 200,
          urbanArea: true,
          permanentHome: true,
        },
      },
    });
    expect(missing['property.address.line1']).toBe('Property address is required');
    expect(missing['property.address.city']).toBe('Property city is required');
    expect(missing['property.address.country']).toBe('Property country is required');

    const sameAddress = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'property' },
      actor: 'customer',
      data: {
        property: {
          sameAsProposer: true,
          propertyType: 'Villa',
          bedrooms: 3,
          floorAreaSqm: 120,
          landAreaSqm: 200,
          urbanArea: true,
          permanentHome: true,
        },
      },
    });
    expect(sameAddress['property.address.line1']).toBeUndefined();
  });

  it('requires the fire-station proximity answer only when the property is not urban', () => {
    const base = {
      property: {
        sameAsProposer: true,
        propertyType: 'Villa',
        bedrooms: 3,
        floorAreaSqm: 120,
        landAreaSqm: 200,
        permanentHome: true,
      },
    };

    const notUrbanMissing = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'property' },
      actor: 'customer',
      data: { property: { ...base.property, urbanArea: false } },
    });
    expect(notUrbanMissing['property.within20MinFireStation']).toMatch(/fire station/i);

    const notUrbanAnswered = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'property' },
      actor: 'customer',
      data: { property: { ...base.property, urbanArea: false, within20MinFireStation: true } },
    });
    expect(notUrbanAnswered['property.within20MinFireStation']).toBeUndefined();

    const urban = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'property' },
      actor: 'customer',
      data: { property: { ...base.property, urbanArea: true } },
    });
    expect(urban['property.within20MinFireStation']).toBeUndefined();
  });

  it('allows an apartment without land area but requires it for other property types', () => {
    const base = {
      sameAsProposer: true,
      bedrooms: 2,
      floorAreaSqm: 90,
      urbanArea: true,
      permanentHome: true,
    };
    const apartment = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'property' },
      actor: 'customer',
      data: { property: { ...base, propertyType: 'Apartment' } },
    });
    const villa = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'property' },
      actor: 'customer',
      data: { property: { ...base, propertyType: 'Villa' } },
    });

    expect(apartment['property.landAreaSqm']).toBeUndefined();
    expect(villa['property.landAreaSqm']).toMatch(/required unless.*apartment/i);
  });

  it('security step requires the two mandatory security booleans to be present', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'security' },
      actor: 'customer',
      data: { security: {} },
    });
    expect(errors['security.doorsFiveLeverLocks']).toBeDefined();
    expect(errors['security.windowsSecured']).toBeDefined();
  });

  it('requires other security details when other security is selected', () => {
    const missing = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'security' },
      actor: 'customer',
      data: {
        security: {
          doorsFiveLeverLocks: true,
          windowsSecured: true,
          additionalSecurity: true,
          additionalSecurityDescription: '',
        },
      },
    });
    expect(missing['security.additionalSecurityDescription']).toBe('Describe the other security at the premises');

    const valid = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'security' },
      actor: 'customer',
      data: {
        security: {
          doorsFiveLeverLocks: true,
          windowsSecured: true,
          additionalSecurity: true,
          additionalSecurityDescription: 'CCTV installed',
        },
      },
    });
    expect(valid['security.additionalSecurityDescription']).toBeUndefined();
  });

  it('rejects High Risk Items over 20% of contents at the sums-insured step (ABY-328)', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'sums-insured' },
      actor: 'customer',
      data: {
        coverage: { buildings: 250000, contents: 10000, allRiskJewellery: 2500 },
        usage: { permanentHome: true, businessUse: false, rentedOut: false },
      },
    });
    expect(errors['coverage.allRiskJewellery']).toMatch(/20%/);
  });

  it('accepts High Risk Items at exactly 20% of contents (ABY-328)', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'sums-insured' },
      actor: 'customer',
      data: {
        coverage: { buildings: 250000, contents: 10000, allRiskJewellery: 2000 },
        usage: { permanentHome: true, businessUse: false, rentedOut: false },
      },
    });
    expect(errors['coverage.allRiskJewellery']).toBeUndefined();
  });

  it('requires a safe confirmation when specified high risk items are present', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'security' },
      actor: 'customer',
      data: {
        coverage: { allRiskJewellery: 5000 },
        security: { doorsFiveLeverLocks: true, windowsSecured: true, additionalSecurity: false },
      },
    });
    expect(errors['security.safeOnPremises']).toMatch(/safe/i);
  });

  it('detects specified high risk items from itemised specifiedItems too', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'security' },
      actor: 'customer',
      data: {
        coverage: { specifiedItems: [{ description: 'Ring', sumInsured: 2000 }] },
        security: { doorsFiveLeverLocks: true, windowsSecured: true, additionalSecurity: false },
      },
    });
    expect(errors['security.safeOnPremises']).toMatch(/safe/i);
  });

  it('accepts a No safe answer (routes to underwriting referral, not a hard block)', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'security' },
      actor: 'customer',
      data: {
        coverage: { allRiskJewellery: 5000 },
        security: { doorsFiveLeverLocks: true, windowsSecured: true, additionalSecurity: false, safeOnPremises: false },
      },
    });
    expect(errors['security.safeOnPremises']).toBeUndefined();
    expect(errors['security.safeDescription']).toBeUndefined();
  });

  it('requires safe details when a safe is confirmed', () => {
    const missing = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'security' },
      actor: 'customer',
      data: {
        coverage: { allRiskJewellery: 5000 },
        security: { doorsFiveLeverLocks: true, windowsSecured: true, additionalSecurity: false, safeOnPremises: true, safeDescription: '' },
      },
    });
    expect(missing['security.safeDescription']).toBe('Describe the safe at the premises');

    const valid = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'security' },
      actor: 'customer',
      data: {
        coverage: { allRiskJewellery: 5000 },
        security: { doorsFiveLeverLocks: true, windowsSecured: true, additionalSecurity: false, safeOnPremises: true, safeDescription: 'Floor-anchored safe over 100kg' },
      },
    });
    expect(valid['security.safeDescription']).toBeUndefined();
    expect(valid['security.safeOnPremises']).toBeUndefined();
  });

  it('does not require a safe when no specified high risk items are present', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'security' },
      actor: 'customer',
      data: {
        coverage: { allRiskJewellery: 0, specifiedItems: [] },
        security: { doorsFiveLeverLocks: true, windowsSecured: true, additionalSecurity: false },
      },
    });
    expect(errors['security.safeOnPremises']).toBeUndefined();
    expect(errors['security.safeDescription']).toBeUndefined();
  });

  it('acceptance step requires confirmation and policy start date', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'acceptance' },
      actor: 'customer',
      data: { eligibility: { confirmation: false }, policy: { startDate: '' } },
    });
    expect(errors['eligibility.confirmation']).toMatch(/accept/i);
    expect(errors['policy.startDate']).toMatch(/valid date|enter/i);
  });

  it('rejects past policy start dates at acceptance', () => {
    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    const startDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'acceptance' },
      actor: 'customer',
      data: { eligibility: { confirmation: true }, policy: { startDate } },
    });

    expect(errors['policy.startDate']).toMatch(/today or later/i);
  });

  it('requires mortgage lender details when bank interest is declared', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'acceptance' },
      actor: 'customer',
      data: {
        eligibility: { confirmation: true },
        policy: { startDate: '2026-05-25' },
        mortgage: { hasMortgage: true, lenderName: '', lenderAddress: '' },
      },
    });
    expect(errors['mortgage.lenderName']).toMatch(/required/i);
    expect(errors['mortgage.lenderAddress']).toMatch(/required/i);
  });

  it('your-quote step has no form validation', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'quote' },
      actor: 'customer',
      data: {},
    });
    expect(errors).toEqual({});
  });

  it('accepts legacy 5+ Years no-claims discount values (ABY-487)', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'wizardStep', id: 'construction-risk' },
      actor: 'customer',
      data: {
        risk: { noClaimsDiscount: '5+ Years' },
      },
    });
    expect(errors['risk.noClaimsDiscount']).toBeUndefined();
  });
});
