// Journey contract: BO policy detail surface.
//
// The BO policy workspace is the operator entry point for every
// post-bind action (endorsement, cancellation, document, audit,
// referral, follow-up). This file pins the canonical controller hook
// so a rename / removal trips CI before the surface disappears.

import { describe, expect, it } from 'vitest';
import { usePolicyDetailViewController } from '../../frontend/src/modules/policies/hooks/usePolicyDetailViewController';

describe('journey: bo-policy-detail', () => {
  it('exposes the canonical policy detail controller hook', () => {
    expect(typeof usePolicyDetailViewController).toBe('function');
  });
});
