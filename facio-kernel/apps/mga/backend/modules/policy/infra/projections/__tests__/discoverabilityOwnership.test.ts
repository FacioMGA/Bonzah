import { describe, expect, it } from 'vitest';
import {
  assertPolicyListIndexOwnership,
  POLICY_LIST_INDEX_FIELD_OWNERSHIP,
} from '../discoverabilityOwnership.js';

describe('policy_list_index ownership manifest', () => {
  it('defines ownership for core discoverability and enrichment fields', () => {
    expect(assertPolicyListIndexOwnership('policyNumber')).toBe('coreTransactional');
    expect(assertPolicyListIndexOwnership('insuredName')).toBe('productTransactional');
    expect(assertPolicyListIndexOwnership('vehicleDisplay')).toBe('productTransactional');
    expect(assertPolicyListIndexOwnership('attentionBucket')).toBe('asyncEnrichment');
  });

  it('contains only supported ownership classes', () => {
    const allowed = new Set(['coreTransactional', 'productTransactional', 'asyncEnrichment']);
    for (const ownership of Object.values(POLICY_LIST_INDEX_FIELD_OWNERSHIP)) {
      expect(allowed.has(ownership)).toBe(true);
    }
  });

  it('keeps transactional display fields outside async ownership', () => {
    const displayFields = [
      'insuredDisplay',
      'vehicleDisplay',
      'policyholderDisplay',
      'policyholderEmail',
      'policyholderPhone',
      'coverageStart',
      'coverageEnd',
    ] as const;
    for (const field of displayFields) {
      expect(assertPolicyListIndexOwnership(field)).not.toBe('asyncEnrichment');
    }
  });
});

