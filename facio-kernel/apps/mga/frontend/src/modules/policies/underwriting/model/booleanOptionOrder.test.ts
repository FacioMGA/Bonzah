import { describe, expect, it } from 'vitest';
import { getBooleanSelectOptions } from './booleanOptionOrder';

describe('booleanOptionOrder', () => {
  it('shows No before Yes for negative-risk underwriting questions', () => {
    expect(getBooleanSelectOptions('hasClaims')).toEqual([
      { value: 'false', label: 'No' },
      { value: 'true', label: 'Yes' },
    ]);
    expect(getBooleanSelectOptions('hasConvictions')).toEqual([
      { value: 'false', label: 'No' },
      { value: 'true', label: 'Yes' },
    ]);
    expect(getBooleanSelectOptions('otherDriversClaims')).toEqual([
      { value: 'false', label: 'No' },
      { value: 'true', label: 'Yes' },
    ]);
    expect(getBooleanSelectOptions('modified')).toEqual([
      { value: 'false', label: 'No' },
      { value: 'true', label: 'Yes' },
    ]);
  });

  it('keeps Yes before No for neutral or positive boolean questions', () => {
    expect(getBooleanSelectOptions('hasAdditionalDrivers')).toEqual([
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ]);
    expect(getBooleanSelectOptions('protectNCB')).toEqual([
      { value: 'true', label: 'Yes' },
      { value: 'false', label: 'No' },
    ]);
  });
});
