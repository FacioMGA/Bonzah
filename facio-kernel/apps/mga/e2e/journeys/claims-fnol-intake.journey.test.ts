// Journey contract: customer FNOL intake (start -> capture -> submit).
//
// Bound to the canonical pure submit-payload builder. The deeper
// proof (multi-step navigation, drawer choreography) lives in
// useClientFnolController + useFnolGuidedFlowCore tests.

import { describe, expect, it } from 'vitest';
import {
  buildFnolSubmitPayload,
  FALLBACK_INCIDENT_CARDS,
} from '../../frontend/src/modules/claims/intake/actions/clientFnol.submit';

describe('journey: claims-fnol-intake', () => {
  it('exposes the canonical FNOL payload builder', () => {
    expect(typeof buildFnolSubmitPayload).toBe('function');
  });

  it('exposes the fallback incident card set covering the canonical loss types', () => {
    const incidentIds = FALLBACK_INCIDENT_CARDS.map((card) => card.id);
    expect(incidentIds).toContain('collision');
    expect(incidentIds).toContain('theft');
    expect(incidentIds).toContain('windscreen');
    expect(incidentIds).toContain('other');
  });
});
