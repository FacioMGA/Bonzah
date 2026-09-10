import { describe, expect, it } from 'vitest';
import {
  ClaimsProgrammeConfigurationError,
  resolveClaimsContractFromProgram,
  visibilityMatchesIncident,
} from '../claimsContract.js';

describe('claimsContract', () => {
  it('fails closed when the published questionnaire has no claims contract', () => {
    expect(() => resolveClaimsContractFromProgram({
      productType: 'MOTOR',
      programmeQuestionnaire: {},
    })).toThrow(ClaimsProgrammeConfigurationError);
  });

  it('parses the published questionnaire claims contract', () => {
    const contract = resolveClaimsContractFromProgram({
      productType: 'MOTOR',
      programmeQuestionnaire: {
        claimsContract: {
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

  it('matches incident visibility tokens consistently', () => {
    expect(visibilityMatchesIncident('All', 'collision')).toBe(true);
    expect(visibilityMatchesIncident('collision', 'collision')).toBe(true);
    expect(visibilityMatchesIncident('theft', 'collision')).toBe(false);
  });
});
