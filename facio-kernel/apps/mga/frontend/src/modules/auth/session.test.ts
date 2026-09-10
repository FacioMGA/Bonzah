import { describe, expect, it } from 'vitest';
import { canAccessConfigureMode, hasPermission } from './session';
import type { AppUser } from '@/src/shared/types/session';

function user(overrides: Partial<AppUser>): AppUser {
  return {
    name: 'Staff',
    role: 'UNDERWRITER',
    ...overrides,
  };
}

describe('BO configure + staff access (ABY-435)', () => {
  it('opens Configure only for settings.configure or platform ADMIN', () => {
    expect(canAccessConfigureMode(user({
      email: 'danny@abbeygate.cy',
      effectivePermissions: ['settings.configure'],
    }))).toBe(true);
    expect(canAccessConfigureMode(user({
      email: 'andy@abbeygate.cy',
      effectivePermissions: ['people.activity.view', 'renewals.allocate'],
    }))).toBe(false);
    expect(canAccessConfigureMode(user({
      role: 'ADMIN',
      email: 'admin@abbeygate.cy',
    }))).toBe(true);
  });

  it('does not treat staff activity as Configure access', () => {
    const andy = user({
      email: 'andy@abbeygate.cy',
      effectivePermissions: ['people.activity.view'],
    });
    expect(hasPermission(andy, 'people.activity.view')).toBe(true);
    expect(canAccessConfigureMode(andy)).toBe(false);
  });
});
