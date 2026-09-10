/**
 * Regression tests for ABY-256 — BO underwriting tab read blank phone
 * even though `quoteData.proposer.phone` was persisted at the customer's
 * payment time.
 *
 * Symptom: the BO `/policies/<id>` BFF response did
 * `{ ...policyData, ...snapshot }` — a top-level shallow spread that
 * let `snapshot.quoteData` (often the wizard's earlier draft, missing
 * fields the payment-side worker had filled in) atomically replace
 * `policy.quoteData`. The customer-entered phone vanished from the
 * underwriting tab's read path.
 *
 * Fix: `deepMergeQuoteData(policy, snapshot)` deep-merges the two
 * `quoteData` objects with snapshot winning at non-empty leaves and
 * policy filling gaps. These tests pin the semantics so a future
 * shallow-spread regression fails loud.
 */
import { describe, expect, it } from 'vitest';
import { isPlainObject } from '../../../../shared/lib/deepMerge.js';
import { deepMergeQuoteData } from '../detailsRouter.js';

describe('detailsRouter — deepMergeQuoteData (ABY-256)', () => {
  it('keeps a non-empty policy value when the snapshot has it blank', () => {
    const policy = {
      proposer: {
        firstName: 'Effie',
        lastName: 'Tester',
        email: 'effie@abbeygate.cy',
        phone: '+35799111226',
      },
    };
    const snapshot = {
      proposer: {
        firstName: 'Effie',
        lastName: 'Tester',
        email: 'effie@abbeygate.cy',
        phone: '', // wizard draft saved before phone was entered
      },
    };

    const merged = deepMergeQuoteData(policy, snapshot);
    const proposer = merged.proposer;
    if (!isPlainObject(proposer)) throw new Error('expected proposer object');

    expect(proposer.phone).toBe('+35799111226');
  });

  it('prefers the snapshot value when both are non-empty (snapshot is the fresher draft)', () => {
    const policy = {
      proposer: { firstName: 'OLD', phone: '+35799111226' },
    };
    const snapshot = {
      proposer: { firstName: 'NEW', phone: '+35799111226' },
    };

    const merged = deepMergeQuoteData(policy, snapshot);
    const proposer = merged.proposer;
    if (!isPlainObject(proposer)) throw new Error('expected proposer object');

    expect(proposer.firstName).toBe('NEW');
  });

  it('treats null and undefined as empty, NOT false/0/empty-array', () => {
    const policy = {
      proposer: {
        marketingConsent: true,
        feedbackConsent: true,
        residencyDuration: 5,
        tags: ['existing'],
      },
    };
    const snapshot = {
      proposer: {
        marketingConsent: false, // valid customer answer — must win
        feedbackConsent: 0,      // valid (legacy boolean-as-number) — must win
        residencyDuration: null, // missing — policy wins
        tags: [],                // empty array is a valid customer answer — must win
      },
    };

    const merged = deepMergeQuoteData(policy, snapshot);
    const proposer = merged.proposer;
    if (!isPlainObject(proposer)) throw new Error('expected proposer object');

    expect(proposer.marketingConsent).toBe(false);
    expect(proposer.feedbackConsent).toBe(0);
    expect(proposer.residencyDuration).toBe(5);
    expect(proposer.tags).toEqual([]);
  });

  it('preserves nested objects untouched by the snapshot', () => {
    const policy = {
      trip: {
        destinations: ['Germany'],
        startDate: '2026-06-01',
        endDate: '2026-06-08',
      },
      proposer: { firstName: 'Effie', phone: '+35799111226' },
    };
    const snapshot = {
      proposer: { firstName: 'Effie' /* no phone */ },
    };

    const merged = deepMergeQuoteData(policy, snapshot);

    expect(merged.trip).toEqual({
      destinations: ['Germany'],
      startDate: '2026-06-01',
      endDate: '2026-06-08',
    });
    const proposer = merged.proposer;
    if (!isPlainObject(proposer)) throw new Error('expected proposer object');
    expect(proposer.phone).toBe('+35799111226');
  });

  it('handles missing / non-object inputs gracefully', () => {
    expect(deepMergeQuoteData(null, null)).toEqual({});
    expect(deepMergeQuoteData(undefined, undefined)).toEqual({});
    expect(deepMergeQuoteData({ a: 1 }, null)).toEqual({ a: 1 });
    expect(deepMergeQuoteData(null, { a: 1 })).toEqual({ a: 1 });
  });

  it('keeps proposer contact when a later patch sends empty strings (ABY-414)', () => {
    const persisted = {
      proposer: {
        firstName: 'George',
        lastName: 'Hamilton',
        email: 'george@example.test',
        phone: '+351910000000',
      },
    };
    const wizardAutosave = {
      proposer: {
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        idType: 'passport',
        address: { line1: 'Rua 1' },
      },
    };

    const merged = deepMergeQuoteData(persisted, wizardAutosave);
    const proposer = merged.proposer;
    if (!isPlainObject(proposer)) throw new Error('expected proposer object');
    const address = proposer.address;
    if (!isPlainObject(address)) throw new Error('expected proposer.address object');

    expect(proposer.firstName).toBe('George');
    expect(proposer.lastName).toBe('Hamilton');
    expect(proposer.email).toBe('george@example.test');
    expect(proposer.phone).toBe('+351910000000');
    expect(proposer.idType).toBe('passport');
    expect(address.line1).toBe('Rua 1');
  });
});
