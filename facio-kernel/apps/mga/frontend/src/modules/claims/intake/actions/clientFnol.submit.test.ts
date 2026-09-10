import { describe, expect, it } from 'vitest';

import { buildFnolSubmitPayload } from './clientFnol.submit';
import { type FnolForm, type NamedDriver } from '../model/clientFnol.types';
import { CanonicalIntakeSchema } from '../../../../../../backend/modules/claims/domain/intakeCanonical';

function makeForm(overrides: Partial<FnolForm> = {}): FnolForm {
  return {
    driverId: 'driver-1',
    driverContactPhone: '+35799111222',
    driverContactEmail: 'driver@example.com',
    unauthorizedDriverFirstName: '',
    unauthorizedDriverLastName: '',
    unauthorizedDriverDateOfBirth: '',
    unauthorizedDriverPhone: '',
    unauthorizedDriverEmail: '',
    incidentDate: '2026-04-07',
    incidentTime: '14:30',
    location: 'Nicosia',
    city: 'Nicosia',
    country: 'CY',
    incidentType: 'collision',
    description: 'Rear-end collision at traffic lights',
    thirdPartyInvolved: 'yes',
    thirdPartyCounts: {
      another_car: 1,
      pedestrian: 1,
      property: 1,
    },
    thirdPartyAnotherCars: [
      {
        fullName: 'Maria Nicolaou',
        telephone: '+35799123456',
        plate: 'ABC123',
        make: 'Toyota',
        model: 'Yaris',
        insurerName: 'Acme Insurance',
      },
    ],
    thirdPartyPedestrians: [
      {
        fullName: 'John Walker',
        telephone: '+35799222333',
      },
    ],
    thirdPartyProperties: [
      {
        fullName: 'Shop Owner',
        telephone: '+35799333444',
      },
    ],
    policeInvolved: 'no',
    policeReportNumber: '',
    policeStation: '',
    driverHasPermission: 'yes',
    driverLicenseYearsHeld: '8',
    driverLicenseIssuedCountry: 'CY',
    carDrivable: 'yes',
    injuriesReported: 'no',
    declarationAccepted: true,
    ...overrides,
  };
}

describe('buildFnolSubmitPayload', () => {
  it('preserves third-party phone values in the canonical intake payload', () => {
    const form = makeForm();
    const selectedDriver: NamedDriver = {
      id: 'driver-1',
      name: 'Named Driver',
      phone: '+35799444555',
      email: 'named.driver@example.com',
      dateOfBirth: '1990-01-01',
    };

    const result = buildFnolSubmitPayload({
      form,
      descriptionTrimmed: form.description,
      selectedDriver,
      selectedThirdPartyKinds: ['another_car', 'pedestrian', 'property'],
      uploads: {
        accidentLocation: [],
        vehicleDamage: [],
        policeReport: [],
        drivingLicence: [],
        vehicleRegistrationCertificate: [],
      },
    });

    expect(result.intake.thirdParty).toEqual(expect.objectContaining({
      involved: true,
      anotherCars: [expect.objectContaining({ telephone: '+35799123456' })],
      pedestrians: [expect.objectContaining({ telephone: '+35799222333' })],
      properties: [expect.objectContaining({ telephone: '+35799333444' })],
    }));
    expect(result.intake.incident).toEqual(expect.objectContaining({
      type: 'collision',
      date: '2026-04-07',
      location: expect.objectContaining({ address: 'Nicosia', country: 'CY' }),
    }));
  });

  // ABY-305 / ABY-301 regression — every payload built by the canonical
  // builder MUST pass `CanonicalIntakeSchema.parse` verbatim. Pre-fix the
  // BO `FnolAmendDrawer` had a parallel inline builder that emitted
  // `incident.location` as a plain string and tripped Zod with
  // `expected object, received string`. Routing the BO through this
  // same builder eliminates the drift; this test pins the contract on
  // both surfaces simultaneously, so any future "convenience" inline
  // copy that drifts will fail loudly here.
  it('produces a payload that passes CanonicalIntakeSchema.parse with no normalisation pass (ABY-305)', () => {
    const form = makeForm();
    const selectedDriver: NamedDriver = {
      id: 'driver-1',
      name: 'Named Driver',
      phone: '+35799444555',
      email: 'named.driver@example.com',
      dateOfBirth: '1990-01-01',
    };

    const { intake } = buildFnolSubmitPayload({
      form,
      descriptionTrimmed: form.description,
      selectedDriver,
      selectedThirdPartyKinds: ['another_car', 'pedestrian', 'property'],
      uploads: {
        accidentLocation: [],
        vehicleDamage: [],
        policeReport: [],
        drivingLicence: [],
        vehicleRegistrationCertificate: [],
      },
    });

    expect(() => CanonicalIntakeSchema.parse(intake)).not.toThrow();
    const parsed = CanonicalIntakeSchema.parse(intake);
    // Pin the exact shape the BO drawer used to violate (plain string).
    expect(typeof parsed.incident.location).toBe('object');
    expect(parsed.incident.location).toEqual({
      address: 'Nicosia',
      city: 'Nicosia',
      country: 'CY',
    });
  });

  it('still passes the schema when the operator skips optional location fields (no defensive defaults)', () => {
    const form = makeForm({ location: '', city: '', country: '' });
    const { intake } = buildFnolSubmitPayload({
      form,
      descriptionTrimmed: form.description,
      selectedDriver: null,
      selectedThirdPartyKinds: [],
      uploads: {
        accidentLocation: [],
        vehicleDamage: [],
        policeReport: [],
        drivingLicence: [],
        vehicleRegistrationCertificate: [],
      },
    });
    const parsed = CanonicalIntakeSchema.parse(intake);
    expect(parsed.incident.location).toEqual({ address: null, city: null, country: null });
  });
});
