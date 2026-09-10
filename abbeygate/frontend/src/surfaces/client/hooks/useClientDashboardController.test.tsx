/* @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the clientPortalClient
const mockListPolicies = vi.fn();
const mockListClaims = vi.fn();
const mockListPolicyDocuments = vi.fn();
const mockGetPolicyFeed = vi.fn();

vi.mock('@/src/surfaces/client/api/clientPortalClient', () => ({
    clientPortalClient: {
        listPolicies: (...args: unknown[]) => mockListPolicies(...args),
        listClaims: (...args: unknown[]) => mockListClaims(...args),
        listPolicyDocuments: (...args: unknown[]) => mockListPolicyDocuments(...args),
        getPolicyFeed: (...args: unknown[]) => mockGetPolicyFeed(...args),
    },
}));

// Mock shared libs that may have side effects
vi.mock('@/src/modules/policies/model/coverageExcess', () => ({
    buildCoverageExcessRows: () => [],
}));
vi.mock('@/src/modules/policies/model/policyStateFlag', () => ({
    USE_POLICY_STATE: false,
}));
vi.mock('@/src/modules/claims/model/claimFormPackage', () => ({
    isClientClaimFormVisible: () => false,
}));

// We test the controller in a JSDOM-like environment so React hooks work.
// But since we only care about the lazy loading logic, we test the mapper
// integration and effect behavior via state assertions.

import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

// Import after mocks
import { useClientDashboardController } from './useClientDashboardController';

function wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(MemoryRouter, { initialEntries: ['/'] }, children);
}

describe('useClientDashboardController', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default bootstrap response — one visible (ISSUED) policy
        mockListPolicies.mockResolvedValue({
            success: true,
            data: [
                { id: 'pol-1', policyId: 'pol-1', status: 'ISSUED', quoteData: { proposer: { firstName: 'Alice' } } },
            ],
        });
        mockListClaims.mockResolvedValue({ success: true, data: [] });

        // Default docs/feed responses
        mockListPolicyDocuments.mockResolvedValue({
            success: true,
            data: [
                { id: 'doc-1', type: 'CERTIFICATE', publicUrl: 'https://cdn/cert.pdf', createdAt: '2025-01-01' },
            ],
        });
        mockGetPolicyFeed.mockResolvedValue({
            success: true,
            data: [
                { id: 'ev-1', actionName: 'POLICY.ISSUED', occurredAt: '2025-01-01' },
            ],
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('bootstraps and loads policies into VM', async () => {
        const { result } = renderHook(() => useClientDashboardController(), { wrapper });

        // Initially loading
        expect(result.current.loading).toBe(true);

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.activePolicies).toHaveLength(1);
        expect(result.current.activePolicies[0].key).toBe('pol-1');
    });

    it('lazy-loads documents when a policy is selected', async () => {
        const { result } = renderHook(() => useClientDashboardController(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        // Single policy auto-focuses → triggers doc loading
        await waitFor(() => {
            expect(mockListPolicyDocuments).toHaveBeenCalledWith('pol-1');
        });

        await waitFor(() => {
            expect(result.current.detail.docs).toHaveLength(1);
            expect(result.current.detail.docs[0].typeLabel).toBe('Certificate');
        });
    });

    it('lazy-loads feed events when a policy is selected', async () => {
        const { result } = renderHook(() => useClientDashboardController(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        // Single policy auto-focuses → triggers feed loading
        await waitFor(() => {
            expect(mockGetPolicyFeed).toHaveBeenCalledWith('pol-1');
        });

        await waitFor(() => {
            expect(result.current.detail.feed).toHaveLength(1);
            expect(result.current.detail.feed[0].title).toBe('Policy issued');
        });
    });

    it('does NOT re-fetch documents for an already-loaded policy', async () => {
        const { result } = renderHook(() => useClientDashboardController(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        // Wait for initial doc load
        await waitFor(() => expect(result.current.detail.docs).toHaveLength(1));

        const callCount = mockListPolicyDocuments.mock.calls.length;

        // Trigger a re-render — docs should NOT be re-fetched
        act(() => {
            result.current.detail.toggleBreakdown();
        });

        // Give time for any potential re-fetch
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(mockListPolicyDocuments.mock.calls.length).toBe(callCount);
    });

    it('handles bootstrap failure gracefully', async () => {
        mockListPolicies.mockRejectedValue(new Error('Network error'));
        mockListClaims.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useClientDashboardController(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.activePolicies).toHaveLength(0);
        expect(result.current.expiredPolicies).toHaveLength(0);
    });

    it('handles docs API failure gracefully', async () => {
        mockListPolicyDocuments.mockRejectedValue(new Error('Docs not available'));

        const { result } = renderHook(() => useClientDashboardController(), { wrapper });

        await waitFor(() => expect(result.current.loading).toBe(false));

        // Should resolve with empty docs, not crash
        await waitFor(() => {
            expect(result.current.detail.docs).toEqual([]);
        });
    });
});
