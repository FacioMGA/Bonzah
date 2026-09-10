import { describe, expect, it } from 'vitest';
import { can } from '../permissions.js';
import { MANAGER_AUTHORITY_PERMISSIONS, UNDERWRITER_PERMISSIONS, parsePermissionKey } from '../permissionTaxonomy.js';

describe('accessControl can()', () => {
  it('allows an exact permission match', () => {
    expect(
      can([{ key: 'users.view' }], 'users.view'),
    ).toBe(true);
  });

  it('denies when the permission is missing', () => {
    expect(
      can([{ key: 'users.view' }], 'users.edit'),
    ).toBe(false);
  });

  it('enforces maxAmount constraints when context exceeds the limit', () => {
    expect(
      can([{ key: 'claims.approve_payment', constraints: { maxAmount: 5000 } }], 'claims.approve_payment', { amount: 7500 }),
    ).toBe(false);
  });

  it('allows constrained permissions when context is within the limit', () => {
    expect(
      can([{ key: 'claims.approve_payment', constraints: { maxAmount: 5000 } }], 'claims.approve_payment', { amount: 4999 }),
    ).toBe(true);
  });

  it('keeps the underwriter baseline technician-safe', () => {
    expect(UNDERWRITER_PERMISSIONS.has('policies.view')).toBe(true);
    expect(UNDERWRITER_PERMISSIONS.has('policies.bind')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('policies.issue')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('reports.export')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('documents.view')).toBe(true);
    expect(UNDERWRITER_PERMISSIONS.has('documents.download')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('people.diary.view')).toBe(true);
    expect(UNDERWRITER_PERMISSIONS.has('renewals.worklist.view')).toBe(true);
    expect(UNDERWRITER_PERMISSIONS.has('people.leave.edit')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('people.leave.cancel')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('settings.configure')).toBe(false);
  });

  it('parses dotted actions so named-operator roles seed the intended permission', () => {
    expect(parsePermissionKey('people.activity.view')).toEqual({ resource: 'people', action: 'activity.view' });
    expect(parsePermissionKey('people.leave.cancel')).toEqual({ resource: 'people', action: 'leave.cancel' });
    expect(parsePermissionKey('underwriting.review.receive')).toEqual({ resource: 'underwriting', action: 'review.receive' });
    expect(parsePermissionKey('renewals.worklist.view')).toEqual({ resource: 'renewals', action: 'worklist.view' });
    expect(parsePermissionKey('settings.configure')).toEqual({ resource: 'settings', action: 'configure' });
  });

  it('grants authority actions through the manager authority overlay', () => {
    expect(MANAGER_AUTHORITY_PERMISSIONS.has('policies.bind')).toBe(true);
    expect(MANAGER_AUTHORITY_PERMISSIONS.has('policies.issue')).toBe(true);
    expect(MANAGER_AUTHORITY_PERMISSIONS.has('reports.export')).toBe(true);
    expect(MANAGER_AUTHORITY_PERMISSIONS.has('documents.download')).toBe(true);
  });
});
