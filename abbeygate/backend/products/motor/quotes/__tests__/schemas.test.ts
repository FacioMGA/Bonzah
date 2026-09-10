import { describe, expect, it } from 'vitest';

import { CreateSessionBodySchema } from '../schemas.js';

describe('public motor quote session schemas', () => {
  it.each(['Car', 'Motorbike', 'Motorcaravan', 'Van to 3.5 tons'])(
    'accepts supported vehicleType seed %s',
    (vehicleType) => {
      const parsed = CreateSessionBodySchema.safeParse({ vehicleType });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.vehicleType).toBe(vehicleType);
    },
  );

  it.each([
    ['motor', 'Car'],
    ['van', 'Van to 3.5 tons'],
    ['motorcycle', 'Motorbike'],
    ['caravan', 'Motorcaravan'],
  ])('normalizes vehicleType alias %s to %s', (vehicleType, expected) => {
    const parsed = CreateSessionBodySchema.safeParse({ vehicleType });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.vehicleType).toBe(expected);
  });

  it('rejects unsupported vehicleType seeds', () => {
    expect(CreateSessionBodySchema.safeParse({ vehicleType: 'Truck' }).success).toBe(false);
  });
});
