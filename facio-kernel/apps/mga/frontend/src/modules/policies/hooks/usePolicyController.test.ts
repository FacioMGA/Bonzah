// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePolicyController } from './usePolicyController';

describe('policy detail tab hydration', () => {
  it('loads the selected tab projection after route hydration and subsequent tab navigation', () => {
    const loadPolicyDetailsById = vi.fn(async () => {});
    const { rerender } = renderHook(({ tab }) => usePolicyController({ view: 'detail', selectedPolicyId: 'policy-a', detailTab: tab, loadPolicyDetailsById }), { initialProps: { tab: 'Policy Holder' } });
    expect(loadPolicyDetailsById).toHaveBeenCalledTimes(1);
    rerender({ tab: 'Underwriting' });
    expect(loadPolicyDetailsById).toHaveBeenCalledTimes(2);
    rerender({ tab: 'Underwriting' });
    expect(loadPolicyDetailsById).toHaveBeenCalledTimes(2);
    rerender({ tab: 'Documents' });
    expect(loadPolicyDetailsById).toHaveBeenCalledTimes(3);
    expect(loadPolicyDetailsById).toHaveBeenLastCalledWith('policy-a');
  });
});
