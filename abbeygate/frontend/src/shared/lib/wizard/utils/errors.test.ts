import { describe, expect, it } from 'vitest';

import {
  collectErrorEntries,
  dedupeErrorEntries,
  getNestedError,
} from './errors';

describe('shared wizard error utilities', () => {
  describe('collectErrorEntries', () => {
    it('collects top-level and nested field messages', () => {
      const formErrors = {
        renewalDate: { type: 'manual', message: 'Please enter your renewal date' },
        additionalDrivers: {
          0: {
            firstName: { type: 'manual', message: 'First name is required' },
          },
        },
      };
      const entries = collectErrorEntries(formErrors);
      expect(entries).toContainEqual({
        field: 'renewalDate',
        message: 'Please enter your renewal date',
      });
      expect(entries).toContainEqual({
        field: 'additionalDrivers.0.firstName',
        message: 'First name is required',
      });
    });

    it('skips reserved RHF metadata keys (type, ref) and empty messages', () => {
      const formErrors = {
        a: {
          type: 'manual',
          ref: { name: 'a' },
          message: '',
        },
        b: {
          type: 'manual',
          ref: { name: 'b' },
          message: 'real',
        },
      };
      const entries = collectErrorEntries(formErrors);
      expect(entries).toEqual([{ field: 'b', message: 'real' }]);
    });

    it('returns "form" as the field for a root-level message', () => {
      const formErrors = { message: 'Top-level form error' };
      expect(collectErrorEntries(formErrors)).toEqual([
        { field: 'form', message: 'Top-level form error' },
      ]);
    });

    it('returns [] for null / non-object inputs', () => {
      expect(collectErrorEntries(null)).toEqual([]);
      expect(collectErrorEntries(undefined)).toEqual([]);
      expect(collectErrorEntries('nope')).toEqual([]);
      expect(collectErrorEntries(42)).toEqual([]);
    });
  });

  describe('dedupeErrorEntries', () => {
    it('dedupes repeated field+message pairs while preserving order', () => {
      const deduped = dedupeErrorEntries([
        { field: 'renewalDate', message: 'Please enter your renewal date' },
        { field: 'renewalDate', message: 'Please enter your renewal date' },
        { field: 'firstName', message: 'First name is required' },
        { field: 'renewalDate', message: 'Please enter your renewal date' },
      ]);
      expect(deduped).toEqual([
        { field: 'renewalDate', message: 'Please enter your renewal date' },
        { field: 'firstName', message: 'First name is required' },
      ]);
    });

    it('returns empty list when no errors remain', () => {
      const entries = dedupeErrorEntries(collectErrorEntries({}));
      expect(entries).toEqual([]);
    });
  });

  describe('getNestedError', () => {
    it('returns the message at a flat key', () => {
      const errors = { firstName: { message: 'Required' } };
      expect(getNestedError(errors, 'firstName')).toBe('Required');
    });

    it('returns the message at a deep dot path', () => {
      const errors = {
        proposer: {
          address: {
            postalCode: { message: 'Invalid postal code' },
          },
        },
      };
      expect(getNestedError(errors, 'proposer.address.postalCode')).toBe(
        'Invalid postal code',
      );
    });

    it('returns a raw string leaf as-is', () => {
      const errors = { telephone: 'Required' };
      expect(getNestedError(errors, 'telephone')).toBe('Required');
    });

    it('returns undefined for missing paths or non-string messages', () => {
      const errors = { firstName: { message: 123 }, address: { city: {} } };
      expect(getNestedError(errors, 'doesNotExist')).toBeUndefined();
      expect(getNestedError(errors, 'firstName')).toBeUndefined();
      expect(getNestedError(errors, 'address.city')).toBeUndefined();
    });

    it('returns undefined when traversal hits a non-object on the way down', () => {
      // `getNestedError` accepts an open-shape error map, so the inline
      // literal lands directly without any cast at the call site.
      expect(getNestedError({ proposer: 'oops' }, 'proposer.firstName')).toBeUndefined();
    });
  });
});
