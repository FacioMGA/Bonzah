/**
 * ABY-542 — motor draft PATCH must not wipe `proposer.dateOfBirth` when a
 * later autosave (wizard step transition or BO save) sends empty-string
 * defaults inside a full `proposer` object.
 *
 * Home/Travel already used `deepMergeQuoteData` (ABY-414). Motor's
 * `updatePublicAutoDraft` previously shallow-merged `{ ...prev, ...incoming }`,
 * so `incoming.proposer` replaced the entire proposer subtree and blank
 * `dateOfBirth: ''` won over a filled value.
 */
import { describe, expect, it } from 'vitest';
import { isPlainObject } from '../../../../shared/lib/deepMerge.js';
import { mergeMotorDraftQuoteData } from '../quoteDataGuards.js';

describe('mergeMotorDraftQuoteData (ABY-542)', () => {
  it('keeps proposer.dateOfBirth when the incoming patch sends an empty string', () => {
    const policyColumn = {
      proposer: {
        firstName: 'George',
        lastName: 'Hamilton',
        email: 'george@example.test',
        phone: '+35799111222',
        dateOfBirth: '1975-09-10',
      },
    };
    const snapshot = {
      proposer: {
        firstName: 'George',
        lastName: 'Hamilton',
        email: 'george@example.test',
        phone: '+35799111222',
      },
    };
    const wizardAutosave = {
      proposer: {
        firstName: 'George',
        lastName: 'Hamilton',
        email: 'george@example.test',
        phone: '+35799111222',
        dateOfBirth: '',
      },
      step: 'vehicle-cover',
    };

    const merged = mergeMotorDraftQuoteData(policyColumn, snapshot, wizardAutosave, 'vehicle-cover');
    const proposer = merged.proposer;
    if (!isPlainObject(proposer)) throw new Error('expected proposer object');

    expect(proposer.dateOfBirth).toBe('1975-09-10');
  });

  it('accepts a non-empty incoming dateOfBirth replacement', () => {
    const prev = { proposer: { firstName: 'Ada', dateOfBirth: '1980-01-01' } };
    const incoming = { proposer: { firstName: 'Ada', dateOfBirth: '1970-06-15' } };

    const merged = mergeMotorDraftQuoteData(prev, {}, incoming, 'policy-holder');
    const proposer = merged.proposer;
    if (!isPlainObject(proposer)) throw new Error('expected proposer object');

    expect(proposer.dateOfBirth).toBe('1970-06-15');
  });

  it('prefers snapshot proposer leaves over the policy column when both are non-empty', () => {
    const policyColumn = { proposer: { firstName: 'OLD', dateOfBirth: '1980-01-01' } };
    const snapshot = { proposer: { firstName: 'NEW', dateOfBirth: '1985-05-05' } };
    const incoming = { proposer: { firstName: 'NEWER' } };

    const merged = mergeMotorDraftQuoteData(policyColumn, snapshot, incoming, 'vehicle-cover');
    const proposer = merged.proposer;
    if (!isPlainObject(proposer)) throw new Error('expected proposer object');

    expect(proposer.firstName).toBe('NEWER');
    expect(proposer.dateOfBirth).toBe('1985-05-05');
  });

  it('allows the policy-holder step to deliberately clear dateOfBirth', () => {
    const previous = { proposer: { firstName: 'Ada', dateOfBirth: '1980-01-01' } };
    const incoming = { proposer: { dateOfBirth: '' } };

    const merged = mergeMotorDraftQuoteData(previous, {}, incoming, 'policy-holder');
    const proposer = merged.proposer;
    if (!isPlainObject(proposer)) throw new Error('expected proposer object');

    expect(proposer.dateOfBirth).toBe('');
  });

  it('allows an explicit vehicle model reset on a later step', () => {
    const previous = { vehicle: { make: 'Toyota', model: 'Corolla' } };
    const incoming = { vehicle: { make: 'Ford', model: '' } };

    const merged = mergeMotorDraftQuoteData(previous, {}, incoming, 'vehicle-cover');
    const vehicle = merged.vehicle;
    if (!isPlainObject(vehicle)) throw new Error('expected vehicle object');

    expect(vehicle.make).toBe('Ford');
    expect(vehicle.model).toBe('');
  });
});
