import { describe, it, expect, beforeEach } from 'vitest';

import * as feAdapter from '../adapters/frontend.js';
import * as beAdapter from '../adapters/backend.js';
import type { ValidationProfile } from '../index.js';

const sampleProfile: ValidationProfile = {
  productCode: 'ADAPTER_SMOKE',
  fields: {
    'proposer.email': { path: 'proposer.email', rule: 'email', required: true },
    'proposer.firstName': { path: 'proposer.firstName', rule: 'name', required: true },
    'proposer.phone': { path: 'proposer.phone', rule: 'phoneE164', required: true },
  },
  steps: [
    { id: 'policy-holder', fields: ['proposer.email', 'proposer.firstName', 'proposer.phone'] },
  ],
  stages: {},
};

describe('@facio/validation/frontend adapter', () => {
  beforeEach(() => {
    feAdapter.ValidationRegistry._resetForTests();
  });

  it('exposes the resolved API', () => {
    expect(typeof feAdapter.validateForContext).toBe('function');
    expect(typeof feAdapter.applyValidationErrors).toBe('function');
    expect(typeof feAdapter.resolveRule).toBe('function');
    expect(typeof feAdapter.ValidationRegistry).toBe('object');
    expect(typeof feAdapter.ruleRegistry).toBe('object');
  });

  it('re-exports env-agnostic types via the wildcard re-export', () => {
    // Imported lazily to ensure the re-export chain resolves
    expect(typeof feAdapter.Email).toBe('object');
    expect(typeof feAdapter.Name).toBe('object');
    expect(typeof feAdapter.MustAccept).toBe('object');
  });

  it('validates a registered profile end-to-end', () => {
    feAdapter.ValidationRegistry.register(sampleProfile);
    const errors = feAdapter.validateForContext({
      productCode: 'ADAPTER_SMOKE',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'customer',
      data: { proposer: { email: 'not-an-email', firstName: 'A', phone: '+12025550123' } },
    });
    expect(errors['proposer.email']).toMatch(/valid email/i);
    expect(errors['proposer.firstName']).toMatch(/at least 2/i);
    expect(errors['proposer.phone']).toBeUndefined();
  });
});

describe('@facio/validation/backend adapter', () => {
  beforeEach(() => {
    beAdapter.ValidationRegistry._resetForTests();
  });

  it('exposes the resolved API', () => {
    expect(typeof beAdapter.validateForContext).toBe('function');
    expect(typeof beAdapter.applyValidationErrors).toBe('function');
    expect(typeof beAdapter.resolveRule).toBe('function');
    expect(typeof beAdapter.ValidationRegistry).toBe('object');
    expect(typeof beAdapter.ruleRegistry).toBe('object');
  });

  it('validates a registered profile end-to-end with a libphonenumber-js phone validator', () => {
    beAdapter.ValidationRegistry.register(sampleProfile);
    const errors = beAdapter.validateForContext({
      productCode: 'ADAPTER_SMOKE',
      stage: { kind: 'wizardStep', id: 'policy-holder' },
      actor: 'server',
      data: { proposer: { email: 'jane@example.com', firstName: 'Jane', phone: '+12025550123' } },
    });
    expect(errors).toEqual({});
  });

  it('isolates state between adapters (different ValidationRegistry instance)', () => {
    expect(feAdapter.ValidationRegistry).not.toBe(beAdapter.ValidationRegistry);
    feAdapter.ValidationRegistry.register({ ...sampleProfile, productCode: 'FE_ONLY' });
    expect(feAdapter.ValidationRegistry.has('FE_ONLY')).toBe(true);
    expect(beAdapter.ValidationRegistry.has('FE_ONLY')).toBe(false);
  });
});
