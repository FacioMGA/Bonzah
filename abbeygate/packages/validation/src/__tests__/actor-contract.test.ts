/**
 * Actor-semantics contract tests (Amendment #3).
 *
 * Each test pins one answer from the "questions that need explicit answers"
 * section of the amendment. If this file ever starts disagreeing with the
 * docstrings in `runner.ts` / `types.ts` / `VALIDATION.md`, one of them is
 * wrong — reconcile before shipping.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationRegistry, validateForContext } from '../adapters/frontend.js';
import type { ValidationProfile } from '../types.js';

const profile: ValidationProfile = {
  productCode: 'ACTOR_CT',
  fields: {
    'proposer.firstName': { path: 'proposer.firstName', rule: 'name', required: true, audience: 'all' },
    'proposer.marketingConsent': { path: 'proposer.marketingConsent', rule: 'mustAccept', required: true, audience: 'customer' },
    'uw.internalNote': { path: 'uw.internalNote', rule: 'nonEmptyString', required: true, audience: 'underwriter' },
    'proposer.email': { path: 'proposer.email', rule: 'email', required: true, audience: 'all' },
  },
  steps: [
    {
      id: 'all-fields',
      fields: [
        'proposer.firstName',
        'proposer.marketingConsent',
        'uw.internalNote',
        'proposer.email',
      ],
      refinements: [
        // Refinement that attempts to flag an UNDERWRITER-only field.
        // The runner MUST drop this issue when actor='customer'.
        (data, ctx) => {
          if (!data['uw.internalNote']) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['uw.internalNote'],
              message: 'UW note required by refinement',
            });
          }
        },
      ],
    },
  ],
  stages: {
    bind: {
      fields: ['proposer.firstName', 'proposer.email'],
    },
  },
};

beforeEach(() => {
  ValidationRegistry.register(profile);
});

afterEach(() => {
  ValidationRegistry._resetForTests();
});

describe('actor semantics contract (#3)', () => {
  // Q1: Does server validate all known fields, or only fields relevant to
  // the requested stage?
  // ANSWER: only the stage's declared fields. Stage is the gate.
  it('server validates only the fields declared for the requested stage', () => {
    const errors = validateForContext({
      productCode: 'ACTOR_CT',
      stage: { kind: 'stage', id: 'bind' },
      actor: 'server',
      data: {},
    });
    // Stage 'bind' declares firstName + email only; marketingConsent and
    // internalNote are NOT in scope even though server sees all audiences.
    expect(Object.keys(errors).sort()).toEqual(['proposer.email', 'proposer.firstName']);
  });

  // Q2: Can underwriter see/validate fields hidden from customers?
  // ANSWER: yes — audience='underwriter' fields are validated when
  // actor='underwriter'. Customer-only fields are NOT validated for
  // underwriters (they don't see that input).
  it('underwriter validates underwriter-only fields, skips customer-only', () => {
    const errors = validateForContext({
      productCode: 'ACTOR_CT',
      stage: { kind: 'wizardStep', id: 'all-fields' },
      actor: 'underwriter',
      data: {},
    });
    expect(errors['uw.internalNote']).toBeDefined();          // underwriter field → flagged
    expect(errors['proposer.marketingConsent']).toBeUndefined(); // customer-only → skipped
    expect(errors['proposer.firstName']).toBeDefined();         // 'all' → flagged
  });

  // Q3: Are refinements applied before or after actor filtering?
  // ANSWER: refinements run on UNFILTERED data (they often need sibling
  // context). But any refinement-authored issue targeting an
  // audience-hidden field is DROPPED in the final output.
  it('refinement-authored errors on audience-hidden fields are dropped for that actor', () => {
    const errors = validateForContext({
      productCode: 'ACTOR_CT',
      stage: { kind: 'wizardStep', id: 'all-fields' },
      actor: 'customer',
      data: {},
    });
    // Refinement tried to flag uw.internalNote (underwriter-only). Customer
    // actor should NOT see this error.
    expect(errors['uw.internalNote']).toBeUndefined();
    // Underwriter, same input, should see SOME error on uw.internalNote
    // (either the atomic-rule one or the refinement-authored one; first
    // issue wins per the Error Contract).
    const uwErrors = validateForContext({
      productCode: 'ACTOR_CT',
      stage: { kind: 'wizardStep', id: 'all-fields' },
      actor: 'underwriter',
      data: {},
    });
    expect(uwErrors['uw.internalNote']).toBeDefined();
  });

  // Q4: Can a refinement raise an error on a field outside the active
  // actor's visible set? (Effectively: no. See Q3.)
  it('server actor bypasses audience filtering entirely', () => {
    const errors = validateForContext({
      productCode: 'ACTOR_CT',
      stage: { kind: 'wizardStep', id: 'all-fields' },
      actor: 'server',
      data: {},
    });
    // Server sees every audience.
    expect(errors['proposer.firstName']).toBeDefined();
    expect(errors['proposer.marketingConsent']).toBeDefined();
    expect(errors['uw.internalNote']).toBeDefined();
    expect(errors['proposer.email']).toBeDefined();
  });

  // Q5: Does focusField on blur suppress cross-field errors that
  // technically involve the focused field?
  // ANSWER: yes. focusField narrows to exactly that path. Errors attached
  // to OTHER paths — even when they were triggered by the focused field —
  // are suppressed during blur, and will re-surface on save/next-click.
  it('focusField narrows output to exactly the focused path', () => {
    const errors = validateForContext({
      productCode: 'ACTOR_CT',
      stage: { kind: 'wizardStep', id: 'all-fields' },
      actor: 'underwriter',
      data: {},
      focusField: 'proposer.firstName',
    });
    expect(Object.keys(errors)).toEqual(['proposer.firstName']);
    expect(errors['uw.internalNote']).toBeUndefined();
  });
});
