/**
 * Error-contract tests (Amendment #5).
 *
 * Pins the shape of `FieldErrors` returned by `validateForContext`.
 * UI code, blur handlers, backend consumers, and tests all depend on
 * these guarantees. If any of them flip, the impact ripples — so lock
 * them down with tests now.
 *
 * Contract (mirrored from `types.ts` -> `FieldErrors`):
 *   - Path format: RHF dot notation, including numeric array indices.
 *   - At most ONE message per path (first issue wins).
 *   - Stable, insertion-preserving iteration order.
 *   - Empty-path refinement issues collapse to the reserved key `'form'`.
 *   - No aliases — profile-declared paths are canonical.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationRegistry, validateForContext } from '../adapters/frontend.js';
import type { ValidationProfile } from '../types.js';

const profile: ValidationProfile = {
  productCode: 'ERR_CT',
  fields: {
    'proposer.firstName': { path: 'proposer.firstName', rule: 'name', required: true },
    'proposer.email': { path: 'proposer.email', rule: 'email', required: true },
    'additionalDrivers.0.firstName': {
      path: 'additionalDrivers.0.firstName',
      rule: 'name',
      required: true,
    },
    'additionalDrivers.1.firstName': {
      path: 'additionalDrivers.1.firstName',
      rule: 'name',
      required: true,
    },
  },
  steps: [
    {
      id: 'ordered',
      fields: [
        'proposer.firstName',
        'proposer.email',
        'additionalDrivers.0.firstName',
        'additionalDrivers.1.firstName',
      ],
      refinements: [
        // Two refinements targeting the same path — first should win.
        (_data, ctx) => {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['proposer.firstName'],
            message: 'Refinement error #1 on firstName',
          });
        },
        (_data, ctx) => {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['proposer.firstName'],
            message: 'Refinement error #2 on firstName',
          });
        },
        // Empty-path refinement — should collapse to 'form'.
        (_data, ctx) => {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [],
            message: 'Object-level invariant violated',
          });
        },
      ],
    },
  ],
  stages: {},
};

beforeEach(() => {
  ValidationRegistry.register(profile);
});

afterEach(() => {
  ValidationRegistry._resetForTests();
});

describe('error contract (#5)', () => {
  it('uses RHF dot notation for nested paths', () => {
    const errors = validateForContext({
      productCode: 'ERR_CT',
      stage: { kind: 'wizardStep', id: 'ordered' },
      actor: 'customer',
      data: {},
    });
    // The profile declares dotted paths — the output keys match exactly.
    expect(errors['proposer.firstName']).toBeDefined();
    expect(errors['proposer.email']).toBeDefined();
  });

  it('preserves numeric array indices in dot paths', () => {
    const errors = validateForContext({
      productCode: 'ERR_CT',
      stage: { kind: 'wizardStep', id: 'ordered' },
      actor: 'customer',
      data: {
        proposer: { firstName: 'Ok', email: 'u@example.com' },
        additionalDrivers: [
          { firstName: '' },
          { firstName: '' },
        ],
      },
    });
    expect(errors['additionalDrivers.0.firstName']).toBeDefined();
    expect(errors['additionalDrivers.1.firstName']).toBeDefined();
    // And they are distinct keys:
    expect(errors['additionalDrivers.0.firstName']).not.toBe(undefined);
    expect(errors['additionalDrivers.1.firstName']).not.toBe(undefined);
  });

  it('keeps at most one message per path — first refinement wins', () => {
    const errors = validateForContext({
      productCode: 'ERR_CT',
      stage: { kind: 'wizardStep', id: 'ordered' },
      actor: 'customer',
      data: {
        proposer: { firstName: 'ValidName', email: 'u@example.com' },
        additionalDrivers: [{ firstName: 'A' }, { firstName: 'B' }],
      },
    });
    // Atomic rules pass (firstName 'ValidName' is fine). Refinements
    // fire — first wins.
    expect(errors['proposer.firstName']).toBe('Refinement error #1 on firstName');
  });

  it('empty-path refinement issues collapse to the reserved "form" key', () => {
    const errors = validateForContext({
      productCode: 'ERR_CT',
      stage: { kind: 'wizardStep', id: 'ordered' },
      actor: 'customer',
      data: {
        proposer: { firstName: 'ValidName', email: 'u@example.com' },
        additionalDrivers: [{ firstName: 'A' }, { firstName: 'B' }],
      },
    });
    expect(errors['form']).toBe('Object-level invariant violated');
  });

  it('iteration order is insertion-preserving (profile order, then refinements)', () => {
    const errors = validateForContext({
      productCode: 'ERR_CT',
      stage: { kind: 'wizardStep', id: 'ordered' },
      actor: 'customer',
      data: {},
    });
    const keys = Object.keys(errors);
    // Profile declares firstName before email before additionalDrivers.
    // The runner builds a flat object in that order, so atomic rules
    // flag them in that order.
    const firstNameIdx = keys.indexOf('proposer.firstName');
    const emailIdx = keys.indexOf('proposer.email');
    const driver0Idx = keys.indexOf('additionalDrivers.0.firstName');
    const driver1Idx = keys.indexOf('additionalDrivers.1.firstName');
    expect(firstNameIdx).toBeLessThan(emailIdx);
    expect(emailIdx).toBeLessThan(driver0Idx);
    expect(driver0Idx).toBeLessThan(driver1Idx);
  });

  it('return type is a plain object — safe to Object.entries / spread', () => {
    const errors = validateForContext({
      productCode: 'ERR_CT',
      stage: { kind: 'wizardStep', id: 'ordered' },
      actor: 'customer',
      data: {},
    });
    // Must be a plain record, not a Map — callers hard-code this assumption.
    expect(typeof errors).toBe('object');
    expect(Array.isArray(errors)).toBe(false);
    expect(Object.entries(errors).length).toBeGreaterThan(0);
  });
});
