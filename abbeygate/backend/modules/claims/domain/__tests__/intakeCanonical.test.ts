import { describe, expect, it } from 'vitest';
import { normalizeCanonicalIntake } from '../intakeCanonical.js';

describe('normalizeCanonicalIntake', () => {
  it('parses the canonical intake shape end-to-end', () => {
    const canonicalPayload = {
      schemaVersion: 2,
      mode: 'guided_incident_flow',
      incident: {
        type: 'collision',
        date: '2026-03-03',
        time: '13:36',
        location: {
          address: 'Nicosia City Centre',
          city: 'Nicosia',
          country: 'Cyprus',
        },
        description: 'Rear-end collision at junction.',
      },
      driver: {
        id: 'driver-1',
        kind: 'named',
        contact: {
          phone: '+35799111222',
          email: 'driver@example.com',
        },
      },
      police: {
        involved: true,
        reportNumber: 'PR-123',
        station: 'Central',
      },
      triage: {
        carDrivable: false,
        injuriesReported: false,
      },
      evidence: {
        vehicleDamage: ['damage-photo-1.png'],
      },
      declarationAccepted: true,
    };

    const result = normalizeCanonicalIntake(canonicalPayload);

    expect(result.incident.type).toBe('collision');
    expect(result.incident.date).toBe('2026-03-03');
    expect(result.incident.location.address).toBe('Nicosia City Centre');
    expect(result.incident.location.city).toBe('Nicosia');
    expect(result.incident.location.country).toBe('Cyprus');
    expect(result.police.reportNumber).toBe('PR-123');
    expect(result.triage.carDrivable).toBe(false);
    expect(result.evidence.vehicleDamage).toEqual(['damage-photo-1.png']);
    expect(result.declarationAccepted).toBe(true);
    // Schema fills defaults so downstream readers don't have to
    // null-check arrays.
    expect(result.thirdParty.anotherCars).toEqual([]);
    expect(result.evidence.accidentLocation).toEqual([]);
  });

  it('does not silently map legacy aliased keys to canonical paths', () => {
    // `spine/v2` Wave 5 deleted the alias-resolution path. Sending the
    // pre-Wave-5 flat shape (incidentDate / incidentType / location:
    // string) no longer populates `incident.date`/`incident.type`/
    // `incident.location.address` — the canonical schema only reads
    // its declared fields. Downstream gates (e.g. the route handler's
    // `description.length < 10` check, or `incident.date` parsing for
    // the claim record) then fail loudly instead of silently importing
    // an empty FNOL.
    const legacy = {
      incidentDate: '2026-03-03',
      incidentType: 'collision',
      location: 'Nicosia',
      description: 'Rear-end collision.',
    };
    const result = normalizeCanonicalIntake(legacy);
    expect(result.incident.date).toBeUndefined();
    expect(result.incident.type).toBeUndefined();
    expect(result.incident.description).toBeUndefined();
    expect(result.incident.location.address).toBeUndefined();
  });
});
