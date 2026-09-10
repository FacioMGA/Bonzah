import { describe, expect, it } from 'vitest';

import { buildBoLoginTarget } from './protectedRouteTarget';

describe('buildBoLoginTarget', () => {
  it('preserves a policy workspace and tab through login', () => {
    expect(buildBoLoginTarget({
      pathname: '/policies/policy-123',
      search: '',
      hash: '#underwriting',
    })).toBe('/login?next=%2Fpolicies%2Fpolicy-123%23underwriting');
  });

  it('preserves query parameters as part of the protected destination', () => {
    expect(buildBoLoginTarget({
      pathname: '/reporting/policies',
      search: '?status=active&country=CY',
      hash: '',
    })).toBe('/login?next=%2Freporting%2Fpolicies%3Fstatus%3Dactive%26country%3DCY');
  });
});
