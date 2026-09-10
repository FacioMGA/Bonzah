/**
 * Runner contract tests (post Phase 2.5).
 *
 * The Phase 2.5 cutover repealed Amendment #4 (`profile.canonicalShape`)
 * and removed the runner's pre-validation coercion pass. The runner now
 * validates incoming data EXACTLY as it arrives — data canonicalization
 * happens once, at write time, via Prisma migrations and the HTTP boundary
 * (e.g. `uwRouter.findLegacyTravelRootKey`).
 *
 * The tests below pin the runner's two remaining built-in behaviours:
 *
 *   1. For REQUIRED fields whose value is `undefined` / `null`, the runner
 *      coerces the value to `""` so the atomic string rule emits its
 *      friendly "please enter …" message (instead of Zod's generic type
 *      error). This is documented at the top of `runner.ts` and is the
 *      ONE built-in normalisation the runner performs.
 *
 *   2. The narrow boolean carve-out lives at the rule level, not the
 *      runner level. `mustAccept` / `bool` accept the literal lowercase
 *      strings `'true'` and `'false'` because RHF/native form libraries
 *      routinely round-trip checkbox/radio values as strings. ANY OTHER
 *      string still fails — we only smooth the specific pothole.
 *
 *   3. ISO date strings stay as strings; the `dob` rule parses them
 *      itself.
 *
 * If anyone reintroduces a `canonicalShape` preprocess on the profile,
 * the FE / BE mirror-parity test will fail (the shared types no longer
 * carry the field) and the freeze guard will flag the new symbol.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValidationRegistry, validateForContext } from '../adapters/frontend.js';
import type { ValidationProfile } from '../types.js';

const profile: ValidationProfile = {
  productCode: 'CANON_CT',
  fields: {
    firstName: { path: 'firstName', rule: 'name', required: true },
    dateOfBirth: { path: 'dateOfBirth', rule: 'dob', required: true },
    email: { path: 'email', rule: 'email', required: true },
    marketingConsent: { path: 'marketingConsent', rule: 'mustAccept' },
  },
  steps: [
    { id: 's1', fields: ['firstName', 'dateOfBirth', 'email', 'marketingConsent'] },
  ],
  stages: {},
};

beforeEach(() => {
  ValidationRegistry.register(profile);
});

afterEach(() => {
  ValidationRegistry._resetForTests();
});

describe('runner contract (post Phase 2.5)', () => {
  // Rule 1: friendly "please enter …" message for missing required fields.
  it('missing required field emits the rule-specific friendly required message', () => {
    const errors = validateForContext({
      productCode: 'CANON_CT',
      stage: { kind: 'wizardStep', id: 's1' },
      actor: 'customer',
      data: {},
    });
    expect(errors['firstName']).toMatch(/at least 2 characters|enter/i);
    expect(errors['email']).toMatch(/email/i);
  });

  // Rule 1: empty string is NOT coerced to undefined — the rule still fires.
  it('empty string in a required field still triggers the required check', () => {
    const errors = validateForContext({
      productCode: 'CANON_CT',
      stage: { kind: 'wizardStep', id: 's1' },
      actor: 'customer',
      data: { firstName: '' },
    });
    expect(errors['firstName']).toBeDefined();
  });

  // Rule 1: whitespace-only required string. The runner does NOT trim — that
  // is the rule's job. The `name` rule's `nonEmptyString`/`min(2)` semantics
  // see "   " as a 3-char string and pass `min(1)` but fail `min(2)`. The
  // friendly message must mention the 2-char minimum, not a generic Zod error.
  it('whitespace-only required string fails with the rule-specific message', () => {
    const errors = validateForContext({
      productCode: 'CANON_CT',
      stage: { kind: 'wizardStep', id: 's1' },
      actor: 'customer',
      data: { firstName: '   ', dateOfBirth: '1985-05-15', email: 'u@example.com' },
    });
    expect(errors['firstName']).toMatch(/at least 2|enter/i);
  });

  // Rule 2: the narrow boolean carve-out at the rule level.
  it("literal string 'true' IS treated as boolean true for mustAccept (rule-level carve-out)", () => {
    const errors = validateForContext({
      productCode: 'CANON_CT',
      stage: { kind: 'wizardStep', id: 's1' },
      actor: 'customer',
      data: {
        firstName: 'Uriel',
        dateOfBirth: '1985-05-15',
        email: 'u@example.com',
        marketingConsent: 'true',
      },
    });
    expect(errors['marketingConsent']).toBeUndefined();
  });

  it("literal string 'false' is treated as boolean false for mustAccept (rule-level carve-out)", () => {
    const errors = validateForContext({
      productCode: 'CANON_CT',
      stage: { kind: 'wizardStep', id: 's1' },
      actor: 'customer',
      data: {
        firstName: 'Uriel',
        dateOfBirth: '1985-05-15',
        email: 'u@example.com',
        marketingConsent: 'false',
      },
    });
    expect(errors['marketingConsent']).toBeDefined();
  });

  it.each(['TRUE', 'True', '1', 'yes', 'on'])(
    'string %p is NOT coerced (carve-out is narrow: only the literal "true"/"false")',
    (rawValue) => {
      const errors = validateForContext({
        productCode: 'CANON_CT',
        stage: { kind: 'wizardStep', id: 's1' },
        actor: 'customer',
        data: {
          firstName: 'Uriel',
          dateOfBirth: '1985-05-15',
          email: 'u@example.com',
          marketingConsent: rawValue,
        },
      });
      expect(errors['marketingConsent']).toBeDefined();
    },
  );

  // Rule 3: ISO dates stay as strings.
  it('DOB validation accepts an ISO date STRING (not a Date object)', () => {
    const errors = validateForContext({
      productCode: 'CANON_CT',
      stage: { kind: 'wizardStep', id: 's1' },
      actor: 'customer',
      data: { firstName: 'Uriel', dateOfBirth: '1985-05-15', email: 'u@example.com' },
    });
    expect(errors['dateOfBirth']).toBeUndefined();
  });
});
