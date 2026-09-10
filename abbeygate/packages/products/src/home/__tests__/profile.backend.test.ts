/**
 * Backend HOME validation profile — issuance-stage runner contract.
 *
 * Pinned next to the profile in `@facio/products` (Phase 4 manifest
 * unification, 2026-04). Imports the runner from
 * `@facio/validation/backend`, the canonical backend entry point.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationRegistry, validateForContext } from '@facio/validation/backend';
import { homeValidationProfile } from '../profile.js';

beforeEach(() => {
  ValidationRegistry.register(homeValidationProfile);
});

afterEach(() => {
  ValidationRegistry._resetForTests();
});

describe('backend HOME validation profile @ issuance', () => {
  it('issuance stage flags missing policyholder fields', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: {},
    });
    expect(errors['proposer.firstName']).toBeDefined();
    expect(errors['proposer.email']).toBeDefined();
    expect(errors['proposer.dateOfBirth']).toBeDefined();
  });

  it('issuance stage passes with valid data', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: {
        proposer: {
          firstName: 'Uriel',
          lastName: 'Aharoni',
          email: 'u@example.com',
          phone: '+44 20 7946 0010',
          dateOfBirth: '1985-05-15',
          nationality: 'United Kingdom',
          domicileCountry: 'United Kingdom',
          address: { line1: '10 Downing St', city: 'London', country: 'United Kingdom', postcode: 'SW1A 2AA' },
        },
        property: {
          propertyType: 'Villa',
          bedrooms: 3,
          floorAreaSqm: 120,
          landAreaSqm: 200,
          urbanArea: true,
          permanentHome: true,
          sameAsProposer: true,
          yearBuilt: '1990 or Later',
          alarm: 'Yes',
          woodenConstruction: false,
          nonCombustibleMaterial: true,
        },
        risk: { previousClaims: 'None', noClaimsDiscount: '5+ Years', increasedExcess: 'STD 150 XS', proposerOver45: true },
        coverage: { buildings: 250000, contents: 50000 },
        usage: { permanentHome: true, businessUse: false, rentedOut: false },
        security: { doorsFiveLeverLocks: true, windowsSecured: true, additionalSecurity: false },
        eligibility: { confirmation: true },
        policy: { startDate: '2030-01-01' },
      },
    });
    expect(errors).toEqual({});
  });

  it('allows an apartment without land area at issuance but blocks another property type', () => {
    const valid = {
      proposer: {
        firstName: 'Uriel',
        lastName: 'Aharoni',
        email: 'u@example.com',
        phone: '+44 20 7946 0010',
        dateOfBirth: '1985-05-15',
        nationality: 'United Kingdom',
        domicileCountry: 'United Kingdom',
        address: { line1: '10 Downing St', city: 'London', country: 'United Kingdom', postcode: 'SW1A 2AA' },
      },
      property: {
        bedrooms: 3,
        floorAreaSqm: 120,
        urbanArea: true,
        permanentHome: true,
        sameAsProposer: true,
        yearBuilt: '1990 or Later',
        alarm: 'Yes',
        woodenConstruction: false,
        nonCombustibleMaterial: true,
      },
      risk: { previousClaims: 'None', noClaimsDiscount: '5+ Years', increasedExcess: 'STD 150 XS', proposerOver45: true },
      coverage: { buildings: 250000, contents: 50000 },
      usage: { permanentHome: true, businessUse: false, rentedOut: false },
      security: { doorsFiveLeverLocks: true, windowsSecured: true, additionalSecurity: false },
      eligibility: { confirmation: true },
      policy: { startDate: '2030-01-01' },
    };
    const apartment = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: { ...valid, property: { ...valid.property, propertyType: 'Apartment' } },
    });
    const villa = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: { ...valid, property: { ...valid.property, propertyType: 'Villa' } },
    });

    expect(apartment['property.landAreaSqm']).toBeUndefined();
    expect(villa['property.landAreaSqm']).toMatch(/required unless.*apartment/i);
  });

  const validIssuanceData = (allRiskJewellery: number) => ({
    proposer: {
      firstName: 'Uriel',
      lastName: 'Aharoni',
      email: 'u@example.com',
      phone: '+44 20 7946 0010',
      dateOfBirth: '1985-05-15',
      nationality: 'United Kingdom',
      domicileCountry: 'United Kingdom',
      address: { line1: '10 Downing St', city: 'London', country: 'United Kingdom', postcode: 'SW1A 2AA' },
    },
    property: {
      propertyType: 'Villa',
      bedrooms: 3,
      floorAreaSqm: 120,
      landAreaSqm: 200,
      urbanArea: true,
      permanentHome: true,
      sameAsProposer: true,
      yearBuilt: '1990 or Later',
      alarm: 'Yes',
      woodenConstruction: false,
      nonCombustibleMaterial: true,
    },
    risk: { previousClaims: 'None', noClaimsDiscount: '5+ Years', increasedExcess: 'STD 150 XS', proposerOver45: true },
    coverage: { buildings: 250000, contents: 10000, allRiskJewellery },
    usage: { permanentHome: true, businessUse: false, rentedOut: false },
    security: { doorsFiveLeverLocks: true, windowsSecured: true, additionalSecurity: false, safeOnPremises: true, safeDescription: 'Wall safe' },
    eligibility: { confirmation: true },
    policy: { startDate: '2030-01-01' },
  });

  it('rejects High Risk Items exceeding 20% of contents (ABY-328)', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: validIssuanceData(2500),
    });
    expect(errors['coverage.allRiskJewellery']).toMatch(/20%/);
  });

  it('accepts High Risk Items at exactly 20% of contents (ABY-328)', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: validIssuanceData(2000),
    });
    expect(errors).toEqual({});
  });

  it('rejects invalid email format on backend', () => {
    const errors = validateForContext({
      productCode: 'HOME',
      stage: { kind: 'stage', id: 'issuance' },
      actor: 'server',
      data: {
        proposer: {
          firstName: 'Uriel',
          lastName: 'Aharoni',
          email: 'bogus',
          phone: '+44 20 7946 0010',
          dateOfBirth: '1985-05-15',
          address: { line1: 'x', city: 'y', country: 'United Kingdom' },
        },
        property: { propertyType: 'Villa' },
        coverage: { buildings: 100, contents: 100 },
      },
    });
    expect(errors['proposer.email']).toMatch(/valid email/i);
  });
});
