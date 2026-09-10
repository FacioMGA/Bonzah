/* @vitest-environment happy-dom */
/**
 * Regression test for ABY-86 — after the customer is saved, the policy
 * workspace `<h1>` was still showing "New Submission" and the
 * subtitle row was empty / "—".
 *
 * Two root causes were fixed in `usePolicyDetailViewController`:
 *
 *  1. `policyholderName` reads the canonical
 *     `quoteData.proposer.{firstName,lastName}` shape.
 *
 *  2. `insuredTitle` was kept at the literal "New Submission"
 *     placeholder unless the manifest's risk identity returned a
 *     non-default string (e.g. a vehicle plate). For products / states
 *     where the insured object is the customer, this meant the title
 *     never updated. The header now falls back to the policyholder
 *     name when the manifest has nothing better to show.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/src/shared/lib/products', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/shared/lib/products')>();
  return {
    ...actual,
    // Stub the registry + risk-identity builder: header tests assert
    // behaviour for the "no manifest", "manifest but trivial identity",
    // and "manifest with meaningful identity" cases. Each case wins by
    // controlling what these two return — wiring up real product
    // manifests would couple this unit test to the entire product
    // registry boot path.
    ProductRegistry: {
      get: vi.fn().mockReturnValue(null),
      register: vi.fn(),
      list: vi.fn(() => []),
      has: vi.fn(() => false),
    },
    buildRiskIdentityFromManifest: vi.fn(() => ({
      kind: 'property',
      primary: '',
      cardinality: 'one',
    })),
    readPath: vi.fn(() => undefined),
  };
});

vi.mock('@/src/modules/policies/api/policiesClient', () => ({
  policiesClient: {},
}));

import { usePolicyDetailViewController } from '../usePolicyDetailViewController';
import { ProductRegistry, buildRiskIdentityFromManifest } from '@/src/shared/lib/products';
import type { PolicyRecord, UnknownRecordSetter } from '../../model/policy';

type Deps = Parameters<typeof usePolicyDetailViewController>[0];

function buildDeps(selectedPortfolio: PolicyRecord | null, overrides: Partial<Deps> = {}): Deps {
  const noopSetter = vi.fn() as UnknownRecordSetter;
  return {
    selectedPortfolio,
    viewingRiskTransactionSnapshot: null,
    endorsementDraftRiskTransactionId: null,
    questionnaireLastSentAt: null,
    qStatus: '',
    getQuoteOrigin: () => 'bo',
    setIsApprovingCancellation: vi.fn(),
    setViewingVersionId: vi.fn(),
    setViewingRiskTransactionSnapshot: noopSetter,
    setViewingRiskTransactionId: vi.fn(),
    setToastMessage: vi.fn(),
    setShowToast: vi.fn(),
    loadPolicyDetails: vi.fn(async () => undefined),
    loadPolicies: vi.fn(async () => undefined),
    setActiveTab: vi.fn(),
    navigate: vi.fn(),
    location: { pathname: '/policies/p-1', search: '', hash: '' },
    editingScope: null,
    setEditingScope: vi.fn(),
    isApprovingCancellation: false,
    ...overrides,
  };
}

beforeEach(() => {
  // Default: no manifest registered for the test product, so we exercise
  // the fallback branch (no manifest → policyholder name wins). Cases
  // that need a manifest override this per-test.
  (ProductRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePolicyDetailViewController.header — ABY-86', () => {
  it('uses canonical proposer.firstName / proposer.lastName for policyholderName', () => {
    const portfolio: PolicyRecord = {
      id: 'p-1',
      productType: 'HOME',
      quoteData: {
        proposer: { firstName: 'Maria', lastName: 'Silva' },
      },
    };
    const { result } = renderHook(() => usePolicyDetailViewController(buildDeps(portfolio)));
    expect(result.current.header.policyholderName).toBe('Maria Silva');
  });

  it('does not read obsolete flat firstName / lastName fields', () => {
    const portfolio: PolicyRecord = {
      id: 'p-2',
      productType: 'HOME',
      quoteData: { firstName: 'Old', lastName: 'Draft' },
    };
    const { result } = renderHook(() => usePolicyDetailViewController(buildDeps(portfolio)));
    expect(result.current.header.policyholderName).toBe('—');
  });

  it('replaces the "New Submission" placeholder with the policyholder name when no manifest identity is available', () => {
    const portfolio: PolicyRecord = {
      id: 'p-3',
      productType: 'HOME',
      quoteData: {
        proposer: { firstName: 'Avi', lastName: 'Cohen' },
      },
    };
    const { result } = renderHook(() => usePolicyDetailViewController(buildDeps(portfolio)));
    // The whole point of ABY-86: never leave the user looking at "New
    // Submission" once we know who the submission is for.
    expect(result.current.header.insuredTitle).not.toBe('New Submission');
    expect(result.current.header.insuredTitle).toBe('Avi Cohen');
  });

  it('keeps insuredTitle = "New Submission" when nothing is known yet', () => {
    const portfolio: PolicyRecord = {
      id: 'p-4',
      productType: 'HOME',
      quoteData: {},
    };
    const { result } = renderHook(() => usePolicyDetailViewController(buildDeps(portfolio)));
    expect(result.current.header.insuredTitle).toBe('New Submission');
    expect(result.current.header.policyholderName).toBe('—');
  });

  it('prefers a meaningful manifest risk identity over the policyholder name', () => {
    (ProductRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue({
      productType: 'MOTOR',
      displayName: 'Motor',
      listColumns: { coverage: { primaryPaths: [] } },
    });
    (buildRiskIdentityFromManifest as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: 'vehicle',
      primary: 'BMW 320 · AB-123-CD',
      cardinality: 'one',
    });
    const portfolio: PolicyRecord = {
      id: 'p-5',
      productType: 'MOTOR',
      quoteData: { proposer: { firstName: 'Avi', lastName: 'Cohen' } },
      vehicleInfo: { make: 'BMW', model: '320', plate: 'AB-123-CD' },
    };
    const { result } = renderHook(() => usePolicyDetailViewController(buildDeps(portfolio)));
    // The vehicle wins the title (the manifest risk identity is
    // meaningful and not equal to displayName), but the subtitle row
    // still gets the customer name.
    expect(result.current.header.insuredTitle).toBe('BMW 320 · AB-123-CD');
    expect(result.current.header.policyholderName).toBe('Avi Cohen');
  });
});
