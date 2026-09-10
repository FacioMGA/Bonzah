import { describe, expect, it } from 'vitest';
import { Step3Schema } from '../step3.js';

const base = {
  vehicleLocation: 'Cyprus',
  countryOfRegistration: 'Cyprus',
  registrationNumber: 'KAA123',
  vin: '',
  coverRequired: 'Comprehensive',
  renewalDate: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10),
  vehicleType: 'Motorbike',
  motorcycleRidersNamed: true,
  make: 'Yamaha',
  model: 'Tracer',
  cabrio: 'No',
  parking: 'Drive',
  fuelType: 'Petrol',
  kmsPerYear: '10,000',
  year: new Date().getFullYear() - 1,
  numberOfSeats: 2,
  modified: false,
  engineSize: 600,
  vehicleValue: 7000,
  ncb: 'None',
  vehicleUse: 'SD&P',
  requiredExcess: '',
  // Phase 6k: bestTimeToCall lives under proposer.* now.
  proposer: { bestTimeToCall: 'Anytime' },
  infoTrueAndAccurate: true,
  fairProcessingAccepted: true,
} satisfies Record<string, unknown>;

describe('Step3Schema motorcycle NCD upload validation', () => {
  it('allows missing NCD upload for >200cc motorcycle (referral handled server-side)', () => {
    const parsed = Step3Schema.safeParse({ ...base, ncdProofUpload: '' });
    expect(parsed.success).toBe(true);
  });

  it('accepts valid upload extensions', () => {
    const parsed = Step3Schema.safeParse({ ...base, ncdProofUpload: 'ncd-proof.pdf' });
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid upload extensions', () => {
    const parsed = Step3Schema.safeParse({ ...base, ncdProofUpload: 'ncd-proof.exe' });
    expect(parsed.success).toBe(false);
  });

  it('allows both registrationNumber and vin to stay empty at quote stage', () => {
    const parsed = Step3Schema.safeParse({ ...base, registrationNumber: '', vin: '' });
    expect(parsed.success).toBe(true);
  });

  it('accepts valid vin when registrationNumber is missing', () => {
    const parsed = Step3Schema.safeParse({ ...base, registrationNumber: '', vin: 'WAUZZZ8V0LA123456' });
    expect(parsed.success).toBe(true);
  });

  it('allows Israel as a country of registration', () => {
    const parsed = Step3Schema.safeParse({ ...base, countryOfRegistration: 'Israel' });
    expect(parsed.success).toBe(true);
  });
});

describe('Step3Schema engine size validation (ADR-0016 batteryKWh)', () => {
  it('rejects engineSize === 0 when fuelType is Petrol', () => {
    const parsed = Step3Schema.safeParse({ ...base, fuelType: 'Petrol', engineSize: 0 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join('.') === 'engineSize')).toBe(true);
    }
  });

  it('accepts engineSize === 0 for towed caravans', () => {
    const parsed = Step3Schema.safeParse({
      ...base,
      vehicleType: 'Motorcaravan',
      fuelType: 'Petrol',
      engineSize: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects engineSize === 1 when fuelType is Petrol', () => {
    const parsed = Step3Schema.safeParse({ ...base, fuelType: 'Petrol', engineSize: 1 });
    expect(parsed.success).toBe(false);
  });

  it('accepts an electric vehicle when canonical batteryKWh is present', () => {
    const parsed = Step3Schema.safeParse({ ...base, fuelType: 'Electric', engineSize: 1, batteryKWh: 64 });
    expect(parsed.success).toBe(true);
  });

  it('rejects electric vehicles without canonical batteryKWh', () => {
    const parsed = Step3Schema.safeParse({ ...base, fuelType: 'Electric', engineSize: 1 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join('.') === 'batteryKWh')).toBe(true);
    }
  });

  it('still rejects below-range engine sizes for ICE cars', () => {
    const parsed = Step3Schema.safeParse({ ...base, vehicleType: 'Car', numberOfSeats: 5, motorcycleRidersNamed: null, fuelType: 'Petrol', engineSize: 100 });
    expect(parsed.success).toBe(false);
  });
});

describe('Step3Schema motorbike engine size range (50-1500cc)', () => {
  it('accepts a 125cc motorbike (the original WhatsApp block)', () => {
    const parsed = Step3Schema.safeParse({ ...base, vehicleType: 'Motorbike', fuelType: 'Petrol', engineSize: 125 });
    expect(parsed.success).toBe(true);
  });

  it('accepts a 50cc moped and a 1500cc motorbike at the range edges', () => {
    expect(Step3Schema.safeParse({ ...base, vehicleType: 'Motorbike', engineSize: 50 }).success).toBe(true);
    expect(Step3Schema.safeParse({ ...base, vehicleType: 'Motorbike', engineSize: 1500 }).success).toBe(true);
  });

  it('rejects a motorbike below 50cc or above 1500cc', () => {
    const tooSmall = Step3Schema.safeParse({ ...base, vehicleType: 'Motorbike', engineSize: 49 });
    const tooLarge = Step3Schema.safeParse({ ...base, vehicleType: 'Motorbike', engineSize: 1501 });
    expect(tooSmall.success).toBe(false);
    expect(tooLarge.success).toBe(false);
    if (!tooSmall.success) {
      expect(tooSmall.error.issues.some((i) => i.path.join('.') === 'engineSize')).toBe(true);
    }
  });

  it('rejects a 125cc CAR (the 300cc floor still applies to cars)', () => {
    const parsed = Step3Schema.safeParse({ ...base, vehicleType: 'Car', numberOfSeats: 5, motorcycleRidersNamed: null, engineSize: 125 });
    expect(parsed.success).toBe(false);
  });
});

describe('Step3Schema motorbike seat + cabriolet rules (ABY-321/336)', () => {
  it('rejects a motorbike with more than 2 seats', () => {
    const parsed = Step3Schema.safeParse({ ...base, vehicleType: 'Motorbike', numberOfSeats: 3 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join('.') === 'numberOfSeats')).toBe(true);
    }
  });

  it('accepts a motorbike with 1 or 2 seats', () => {
    expect(Step3Schema.safeParse({ ...base, vehicleType: 'Motorbike', numberOfSeats: 1 }).success).toBe(true);
    expect(Step3Schema.safeParse({ ...base, vehicleType: 'Motorbike', numberOfSeats: 2 }).success).toBe(true);
  });

  it('still allows a car with up to 9 seats', () => {
    // A car carries no motorcycleRidersNamed coupling; keep the field as
    // the schema's nullable optional default.
    const car = { ...base, vehicleType: 'Car', engineSize: 1600, numberOfSeats: 5, motorcycleRidersNamed: null };
    expect(Step3Schema.safeParse(car).success).toBe(true);
    expect(Step3Schema.safeParse({ ...car, numberOfSeats: 9 }).success).toBe(true);
    expect(Step3Schema.safeParse({ ...car, numberOfSeats: 10 }).success).toBe(false);
  });

  it('rejects a cabriolet motorbike', () => {
    const parsed = Step3Schema.safeParse({ ...base, vehicleType: 'Motorbike', cabrio: 'Yes' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join('.') === 'cabrio')).toBe(true);
    }
  });

  it('still allows a cabriolet car', () => {
    const car = { ...base, vehicleType: 'Car', engineSize: 1600, numberOfSeats: 4, cabrio: 'Yes', motorcycleRidersNamed: null };
    expect(Step3Schema.safeParse(car).success).toBe(true);
  });
});
