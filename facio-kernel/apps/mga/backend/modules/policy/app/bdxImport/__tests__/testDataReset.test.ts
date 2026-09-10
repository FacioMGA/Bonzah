import { describe, it, expect } from 'vitest';
import {
  TEST_DATA_RESET_TENANT_ALLOWLIST,
  TEST_EMAIL_PATTERNS,
  assertTenantEligibleForTestDataReset,
} from '../testDataReset.js';

describe('testDataReset tenant allowlist', () => {
  it('allows only the go-live tenants (cy/pt/gr)', () => {
    expect([...TEST_DATA_RESET_TENANT_ALLOWLIST].sort()).toEqual([
      'abbeygate-cy',
      'abbeygate-gr',
      'abbeygate-pt',
    ]);
  });

  it.each(['abbeygate-cy', 'abbeygate-pt', 'abbeygate-gr'])(
    'accepts eligible tenant %s',
    (slug) => {
      expect(() => assertTenantEligibleForTestDataReset(slug)).not.toThrow();
    },
  );

  it('refuses Spain (no imported book — every row would be untagged)', () => {
    expect(() => assertTenantEligibleForTestDataReset('abbeygate-es')).toThrow(
      /not eligible/i,
    );
  });

  it('refuses unknown tenants', () => {
    expect(() => assertTenantEligibleForTestDataReset('acme-tenant')).toThrow(
      /not eligible/i,
    );
  });
});

describe('testDataReset test-email predicate', () => {
  it('covers the operator-confirmed internal/seed markers and excludes import.local', () => {
    expect(TEST_EMAIL_PATTERNS).toEqual(
      expect.arrayContaining([
        '%example%',
        '%test%',
        '%@facio.io',
        '%@abbeygate.cy',
        '%@abbeygate.pt',
        '%@abbeygate.gr',
      ]),
    );
    // import.local is stamped on REAL migrated policies — must never be a marker.
    expect(TEST_EMAIL_PATTERNS.some((p) => p.includes('import.local'))).toBe(false);
  });
});
