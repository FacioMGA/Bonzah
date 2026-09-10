import { describe, expect, it } from 'vitest';
import { UNDERWRITER_PERMISSIONS } from '../permissionTaxonomy.js';
import {
  CONFIGURE_ADMIN_PERMISSIONS,
  NAMED_OPERATOR_ROLES,
  requiredPermissionForPolicyAssignment,
} from '../namedOperatorRoles.js';

describe('named operator roles (ABY-434/435/437)', () => {
  it('keeps technician staff on diary + renewals worklist + leave view only', () => {
    expect(UNDERWRITER_PERMISSIONS.has('people.diary.view')).toBe(true);
    expect(UNDERWRITER_PERMISSIONS.has('people.leave.view')).toBe(true);
    expect(UNDERWRITER_PERMISSIONS.has('renewals.worklist.view')).toBe(true);
    expect(UNDERWRITER_PERMISSIONS.has('people.activity.view')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('people.leave.edit')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('people.leave.cancel')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('renewals.allocate')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('settings.configure')).toBe(false);
    expect(UNDERWRITER_PERMISSIONS.has('underwriting.review.receive')).toBe(false);
  });

  it('assigns Configure admin to Danny and Peter only', () => {
    const configure = NAMED_OPERATOR_ROLES.find((role) => role.name === 'Configure Admin');
    expect(configure?.emails).toEqual(['danny@abbeygate.cy', 'peter@abbeygate.cy']);
    expect(configure?.emails).not.toContain('andy@abbeygate.cy');
    expect(CONFIGURE_ADMIN_PERMISSIONS).toContain('settings.configure');
  });

  it('assigns activity, allocate, and UW take-review to Danny, Peter, and Andy', () => {
    for (const name of ['Staff Activity', 'Renewals Allocate', 'Underwriting Review']) {
      const role = NAMED_OPERATOR_ROLES.find((entry) => entry.name === name);
      expect(role?.emails).toEqual(expect.arrayContaining([
        'danny@abbeygate.cy',
        'peter@abbeygate.cy',
        'andy@abbeygate.cy',
      ]));
    }
  });

  it('assigns leave input to Peter and Danny only', () => {
    const leave = NAMED_OPERATOR_ROLES.find((role) => role.name === 'Leave Input');
    expect(leave?.emails).toEqual(['danny@abbeygate.cy', 'peter@abbeygate.cy']);
    expect(leave?.permissions).toEqual(['people.leave.edit']);
  });

  it('assigns leave cancellation to Danny, Peter, and both Andy accounts', () => {
    const leave = NAMED_OPERATOR_ROLES.find((role) => role.name === 'Leave Cancellation');
    expect(leave?.permissions).toEqual(['people.leave.cancel']);
    expect(leave?.emails).toEqual([
      'danny@abbeygate.cy',
      'peter@abbeygate.cy',
      'andy@abbeygate.cy',
      'andy@abbeygate.pt',
    ]);
  });

  it('requires UW receive for assign-to-self and allocate for assigning others', () => {
    expect(requiredPermissionForPolicyAssignment({
      actorUserId: 'danny',
      assignedToUserId: 'danny',
    })).toBe('underwriting.review.receive');
    expect(requiredPermissionForPolicyAssignment({
      actorUserId: 'danny',
      assignedToUserId: 'effie',
    })).toBe('renewals.allocate');
  });
});
