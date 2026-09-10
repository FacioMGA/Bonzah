import { describe, expect, it } from 'vitest';
import '@/src/products';
import { resolveRequiredness } from './requirednessResolver';

describe('resolveRequiredness', () => {
  it('returns manifest-driven required keys for motor (canonical proposer.* paths)', () => {
    const result = resolveRequiredness({ actor: 'underwriter', stage: 'draft', productType: 'MOTOR' });
    expect(result.requiredKeys).toEqual(
      expect.arrayContaining(['proposer.firstName', 'proposer.lastName', 'proposer.phone', 'proposer.email'])
    );
    // Phase 6k: the legacy flat policyholder slugs must NOT be present.
    expect(result.requiredKeys).not.toContain('firstName');
    expect(result.requiredKeys).not.toContain('lastName');
    expect(result.requiredKeys).not.toContain('telephone');
    expect(result.requiredKeys).not.toContain('email');
  });

  it('evaluates conditional required fields from manifest data', () => {
    const result = resolveRequiredness({
      actor: 'underwriter',
      stage: 'draft',
      productType: 'MOTOR',
      data: { hasClaims: true },
    });
    expect(result.requiredKeys).toContain('claimsDetails');
    expect(result.visibleKeys).toContain('claimsDetails');
  });

  it('uses registered product manifests for non-motor products too', () => {
    const travel = resolveRequiredness({ actor: 'underwriter', stage: 'draft', productType: 'TRAVEL' });
    expect(travel.requiredKeys).toEqual(expect.arrayContaining(['trip.planType', 'trip.startDate', 'quote.selectedPlan']));
  });
});

