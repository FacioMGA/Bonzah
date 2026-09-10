import { describe, expect, it } from 'vitest';
import { registerAllProducts } from '../../../../products/registerProducts.js';
import {
  buildContractClaimFormFields,
  resolveClaimsContractFromProgram,
  visibilityMatchesIncident,
} from '../claimsContract.js';

registerAllProducts();

describe('claimsContract', () => {
  it('falls back to the registered product defaults when metadata is missing', () => {
    const contract = resolveClaimsContractFromProgram({
      productType: 'MOTOR',
      programMetadata: {},
    });
    expect(contract.productType).toBe('MOTOR');
    expect(contract.fnol.incidentTypes.length).toBeGreaterThan(0);
    expect(contract.fnol.thirdPartyKinds.length).toBeGreaterThan(0);
  });

  it('parses program metadata claimsConfig and overrides defaults', () => {
    const contract = resolveClaimsContractFromProgram({
      productType: 'MOTOR',
      programMetadata: {
        claimsConfig: {
          version: 2,
          fnol: {
            incidentTypes: [{ id: 'collision', label: 'Road collision' }],
            thirdPartyKinds: [{ id: 'another_car', label: 'Another car' }],
            rules: { minDescriptionLength: 20, requiresThirdPartyFor: ['collision'] },
          },
          fullClaimForm: {
            fields: [
              {
                fieldId: 'contact_email',
                section: 'Contact',
                label: 'Email',
                type: 'text',
                mode: 'editable_prefilled',
                required: true,
                prefillPath: 'policy.email',
                valueSource: 'policy',
              },
            ],
          },
        },
      },
    });
    expect(contract.version).toBe(2);
    expect(contract.fnol.rules.minDescriptionLength).toBe(20);
    expect(contract.fullClaimForm.fields).toHaveLength(1);
  });

  it('builds contract claim form fields with prefill + visibility', () => {
    const contract = resolveClaimsContractFromProgram({
      productType: 'MOTOR',
      programMetadata: {
        claimsConfig: {
          fnol: { incidentTypes: [{ id: 'collision', label: 'Collision' }] },
          fullClaimForm: {
            fields: [
              {
                fieldId: 'contact_email',
                section: 'Contact',
                label: 'Email',
                type: 'text',
                mode: 'editable_prefilled',
                required: true,
                prefillPath: 'policy.email',
                valueSource: 'policy',
                visibility: 'collision',
              },
              {
                fieldId: 'theft_report',
                section: 'Police',
                label: 'Theft report number',
                type: 'text',
                mode: 'blank_optional',
                visibility: 'theft',
              },
            ],
          },
        },
      },
    });
    const fields = buildContractClaimFormFields({
      contract,
      incidentType: 'collision',
      policySnapshot: { email: 'claims@example.com' },
      fnolSnapshot: {},
    });
    expect(fields).toHaveLength(1);
    expect(fields[0].fieldId).toBe('contact_email');
    expect(fields[0].prefill).toBe('claims@example.com');
  });

  it('matches incident visibility tokens consistently', () => {
    expect(visibilityMatchesIncident('All', 'collision')).toBe(true);
    expect(visibilityMatchesIncident('collision', 'collision')).toBe(true);
    expect(visibilityMatchesIncident('theft', 'collision')).toBe(false);
  });
});

