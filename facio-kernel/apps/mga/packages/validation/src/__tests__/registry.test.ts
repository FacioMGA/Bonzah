import { afterEach, describe, expect, it } from 'vitest';
import { ValidationRegistry } from '../adapters/frontend.js';
import type { ValidationProfile } from '../types.js';

const stub = (code: string): ValidationProfile => ({
  productCode: code,
  fields: {},
  steps: [],
  stages: {},
});

describe('ValidationRegistry', () => {
  afterEach(() => {
    ValidationRegistry._resetForTests();
  });

  it('registers and retrieves case-insensitively', () => {
    const profile = stub('MOTOR');
    ValidationRegistry.register(profile);
    expect(ValidationRegistry.has('motor')).toBe(true);
    expect(ValidationRegistry.get('MOTOR')).toBe(profile);
    expect(ValidationRegistry.get('motor')).toBe(profile);
  });

  it('returns undefined for unknown products', () => {
    expect(ValidationRegistry.get('gadget')).toBeUndefined();
    expect(ValidationRegistry.has('gadget')).toBe(false);
  });

  it('lists all profiles', () => {
    ValidationRegistry.register(stub('MOTOR'));
    ValidationRegistry.register(stub('HOME'));
    const list = ValidationRegistry.list();
    expect(list).toHaveLength(2);
  });
});
