import { describe, expect, it } from 'vitest';
import { registerAllProducts } from '../../../../products/registerProducts.js';
import { resolveClaimsContractFromProgram } from '../claimsContract.js';
import { validateClaimFormResponses, validateGuidedFnolForm } from '../claimsValidation.js';
import type { ClaimFormPackage } from '../claimFormPackage.js';

registerAllProducts();

describe('claimsValidation', () => {
  it('validates guided FNOL against contract rules', () => {
    const contract = resolveClaimsContractFromProgram({
      productType: 'MOTOR',
      programMetadata: {
        claimsConfig: {
          fnol: {
            incidentTypes: [{ id: 'collision', label: 'Collision' }],
            rules: { minDescriptionLength: 10, requiresThirdPartyFor: ['collision'] },
          },
        },
      },
    });
    const bad = validateGuidedFnolForm({
      form: {
        incident: { type: 'collision', description: 'short' },
        driver: { id: '', kind: 'named' },
        thirdParty: { involved: '' },
        police: { involved: false },
        triage: { carDrivable: '', injuriesReported: '' },
      },
      contract,
      policyId: 'p1',
      namedDrivers: [{ id: 'd1', name: 'John Doe' }],
    });
    expect(bad.valid).toBe(false);
    expect(Object.keys(bad.errors).length).toBeGreaterThan(1);
  });

  it('accepts a valid guided FNOL payload', () => {
    const contract = resolveClaimsContractFromProgram({
      productType: 'MOTOR',
      programMetadata: {},
    });
    const result = validateGuidedFnolForm({
      form: {
        incident: {
          type: 'collision',
          description: 'Rear end collision in traffic near city center.',
          date: '2026-02-01',
          location: 'Main street',
          city: 'Nicosia',
          country: 'Cyprus',
        },
        driver: { id: 'driver-1', kind: 'named' },
        thirdParty: { involved: 'yes', kinds: ['another_car'], anotherCars: [{ fullName: 'Jane Roe', insurerName: 'Insurer A' }] },
        police: { involved: 'yes', reportNumber: 'PR-55' },
        triage: { carDrivable: 'yes', injuriesReported: 'no' },
      },
      contract,
      policyId: 'p1',
      namedDrivers: [{ id: 'driver-1', name: 'John Doe' }],
    });
    expect(result.valid).toBe(true);
  });

  it('validates claim form required and rule-driven fields', () => {
    const pkg: ClaimFormPackage = {
      version: 1,
      status: 'OPEN',
      sentAt: new Date().toISOString(),
      fields: [
        {
          fieldId: 'contact_email',
          section: 'Contact',
          label: 'Email',
          type: 'text',
          mode: 'blank_required',
          required: true,
          valueSource: 'user',
          validation: 'email',
        },
      ],
      context: { incidentType: 'collision', claimType: 'OWN_DAMAGE', country: 'Cyprus', namedDrivers: [] },
      sourceSnapshot: { policyNumber: 'P-1', policyHolderName: 'Holder' },
    };
    const invalid = validateClaimFormResponses({
      claimFormPackage: pkg,
      responses: { contact_email: 'not-an-email' },
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.contact_email).toBeTruthy();

    const valid = validateClaimFormResponses({
      claimFormPackage: pkg,
      responses: { contact_email: 'ok@example.com' },
    });
    expect(valid.valid).toBe(true);
  });
});

