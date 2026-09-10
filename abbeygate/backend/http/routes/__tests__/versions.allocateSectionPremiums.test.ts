import { describe, expect, it } from 'vitest';
import { allocateSectionPremiums } from '../../../modules/policy/http/versionsRouter.js';

describe('allocateSectionPremiums', () => {
  it('falls back to section basis when raw deltas are zero', () => {
    const out = allocateSectionPremiums({
      tpl: 0,
      ownDamage: 0,
      hasOwnDamage: true,
      total: -93.33,
      tplBasis: 140,
      ownDamageBasis: 798.83,
    });

    expect(out.tpl).toBeCloseTo(-13.92, 2);
    expect(out.ownDamage).toBeCloseTo(-79.41, 2);
    expect(Number((out.tpl + out.ownDamage).toFixed(2))).toBe(-93.33);
  });
});
