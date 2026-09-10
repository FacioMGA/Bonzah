import { describe, expect, it } from 'vitest';

import { filterStaffDirectoryForAssign } from '../staffAssignHelpers';

describe('staffAssignHelpers', () => {
  it('filters staff directory by display name and email', () => {
    const matches = filterStaffDirectoryForAssign([
      { id: 'user-1', name: 'Peter Boucher', email: 'peter@abbeygate.cy' },
      { id: 'user-2', name: 'Andy Manager', email: 'andy@abbeygate.cy' },
    ], 'peter');

    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('user-1');
    expect(matches[0]?.email).toBe('peter@abbeygate.cy');
  });
});
