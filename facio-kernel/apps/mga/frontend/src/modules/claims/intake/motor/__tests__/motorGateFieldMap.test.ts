import { describe, expect, it } from 'vitest';
import { motorGateFieldMap, resolveMotorMissingFields } from '../motorGateFieldMap';

describe('motorGateFieldMap canonical drift guard', () => {
  it('uses canonical intake paths for gate-required fields', () => {
    const required = new Set(
      motorGateFieldMap.flatMap((item) => item.requiredPaths)
    );
    expect(required.has('incident.type')).toBe(true);
    expect(required.has('incident.date')).toBe(true);
    expect(required.has('incident.location.address')).toBe(true);
    expect(required.has('incident.description')).toBe(true);
  });

  it('does not use deprecated legacy aliases', () => {
    const required = new Set(
      motorGateFieldMap.flatMap((item) => item.requiredPaths)
    );
    expect(required.has('incident.lossType')).toBe(false);
    expect(required.has('incident.dateOfLoss')).toBe(false);
    expect(required.has('incident.location')).toBe(false);
    expect(required.has('narrative')).toBe(false);
  });

  it('derives missing fields deterministically from failing gates', () => {
    const missing = resolveMotorMissingFields({
      gates: [
        { key: 'lossTypePresent', label: 'Loss type present', status: 'FAIL' },
        { key: 'dateOfLossPresent', label: 'Date of loss present', status: 'PASS' },
        { key: 'narrativePresent', label: 'Narrative present', status: 'FAIL' },
      ],
      snapshot: {
        incident: { type: '', description: '' },
      },
    });
    expect(missing.map((item) => `${item.gateKey}:${item.path}`)).toEqual([
      'lossTypePresent:incident.type',
      'narrativePresent:incident.description',
    ]);
  });
});
