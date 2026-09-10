/* @vitest-environment happy-dom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePolicyProgramsBinders } from './usePolicyProgramsBinders';

const mocks = vi.hoisted(() => ({
  listBinders: vi.fn(),
  listPrograms: vi.fn(),
  assignPolicyProgramBinder: vi.fn(),
}));

vi.mock('@/src/modules/programs/api/programsApiClient', () => ({
  programsApiClient: {
    listBinders: mocks.listBinders,
    listPrograms: mocks.listPrograms,
  },
}));

vi.mock('../api/policiesClient', () => ({
  policiesClient: {
    assignPolicyProgramBinder: mocks.assignPolicyProgramBinder,
  },
}));

type Args = Parameters<typeof usePolicyProgramsBinders>[0];

function buildArgs(overrides: Partial<Args> = {}): Args {
  const selectedPortfolio: Args['selectedPortfolio'] = { id: 'policy-1', productType: 'TRAVEL' };
  return {
    view: 'detail',
    activeTab: 'Underwriting',
    selectedPortfolio,
    selectedPortfolioId: 'policy-1',
    setToastMessage: vi.fn(),
    setShowToast: vi.fn(),
    qStatus: 'Draft',
    onConfirmationNeeded: vi.fn(),
    currentProductLabel: 'Travel',
    ...overrides,
  };
}

describe('usePolicyProgramsBinders', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.useRealTimers();
    mocks.listBinders.mockReset();
    mocks.listPrograms.mockReset();
    mocks.assignPolicyProgramBinder.mockReset();
    mocks.assignPolicyProgramBinder.mockResolvedValue({ success: true, data: {} });
  });

  it('auto-assigns only an active program/binder pair authorized for the policy product', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'binder-motor',
          status: 'ACTIVE',
          productAuthorities: [{ productCode: 'MOTOR', status: 'ACTIVE' }],
        },
        {
          id: 'binder-travel',
          status: 'ACTIVE',
          productAuthorities: [{ productCode: 'TRAVEL', status: 'ACTIVE' }],
        },
      ],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'program-motor',
          status: 'ACTIVE',
          productType: 'MOTOR',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-motor' }],
        },
        {
          id: 'program-travel',
          status: 'ACTIVE',
          productType: 'TRAVEL',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-travel' }],
        },
      ],
    });

    renderHook(() => usePolicyProgramsBinders(buildArgs()));

    await waitFor(() => expect(mocks.assignPolicyProgramBinder).toHaveBeenCalled());

    expect(mocks.assignPolicyProgramBinder).toHaveBeenCalledTimes(1);
    expect(mocks.assignPolicyProgramBinder).toHaveBeenCalledWith('policy-1', 'program-travel', 'binder-travel');
  });

  it('exposes EVERY active binder in `availableBinders`, regardless of the policy product (ABY-249)', async () => {
    // The BO operator needs to see every active binder in the dropdown
    // so they can switch a default-assigned policy onto a different
    // product's binder (Uriel's: "I'm fine with default, but why other
    // binders are not there?"). The dropdown intentionally does NOT
    // pre-filter by `selectedPolicyProductType` — that pre-filter is
    // what hid Motor/Home binders the moment a policy happened to be
    // defaulted to Travel and broke the canonical "binder defines the
    // product" workflow. The save-side guard (separate test below)
    // still refuses to auto-write a mismatched (binder, productType)
    // pair, so visibility ≠ blind persistence.
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [
        { id: 'binder-motor', status: 'ACTIVE', productAuthorities: [{ productCode: 'MOTOR', status: 'ACTIVE' }] },
        { id: 'binder-home', status: 'ACTIVE', productAuthorities: [{ productCode: 'HOME', status: 'ACTIVE' }] },
        { id: 'binder-travel', status: 'ACTIVE', productAuthorities: [{ productCode: 'TRAVEL', status: 'ACTIVE' }] },
      ],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [
        { id: 'program-motor', status: 'ACTIVE', productType: 'MOTOR', binderLinks: [{ status: 'ACTIVE', binderId: 'binder-motor' }] },
        { id: 'program-home', status: 'ACTIVE', productType: 'HOME', binderLinks: [{ status: 'ACTIVE', binderId: 'binder-home' }] },
        { id: 'program-travel', status: 'ACTIVE', productType: 'TRAVEL', binderLinks: [{ status: 'ACTIVE', binderId: 'binder-travel' }] },
      ],
    });

    // Policy is currently defaulted to TRAVEL but the operator must
    // still see Motor and Home binders in the dropdown so they can
    // override the default.
    const { result } = renderHook(() => usePolicyProgramsBinders(buildArgs()));

    await waitFor(() => expect(result.current.availableBinders.length).toBeGreaterThan(0));

    const exposedBinderIds = result.current.availableBinders.map((b) => String((b as Record<string, unknown>).id || '')).sort();
    expect(exposedBinderIds).toEqual(['binder-home', 'binder-motor', 'binder-travel']);
  });

  it('does not write a binder/program assignment when the binder lacks product authority', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'binder-motor',
          status: 'ACTIVE',
          productAuthorities: [{ productCode: 'MOTOR', status: 'ACTIVE' }],
        },
      ],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'program-travel',
          status: 'ACTIVE',
          productType: 'TRAVEL',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-motor' }],
        },
      ],
    });

    renderHook(() => usePolicyProgramsBinders(buildArgs()));

    await waitFor(() => expect(mocks.listBinders).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    expect(mocks.assignPolicyProgramBinder).not.toHaveBeenCalled();
  });

  it('does not auto-stamp the first program/binder onto a product-less new submission (ABY-438)', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'binder-open-market',
          status: 'ACTIVE',
          productAuthorities: [{ productCode: 'OPEN_MARKET', status: 'ACTIVE' }],
        },
        {
          id: 'binder-health',
          status: 'ACTIVE',
          productAuthorities: [{ productCode: 'HEALTH', status: 'ACTIVE' }],
        },
      ],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'program-open-market',
          status: 'ACTIVE',
          productType: 'OPEN_MARKET',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-open-market' }],
        },
        {
          id: 'program-health',
          status: 'ACTIVE',
          productType: 'HEALTH',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-health' }],
        },
      ],
    });

    const { result } = renderHook(() => usePolicyProgramsBinders(buildArgs({
      selectedPortfolio: { id: 'policy-new', productType: undefined },
      selectedPortfolioId: 'policy-new',
      currentProductLabel: '',
    })));

    await waitFor(() => expect(mocks.listBinders).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    expect(mocks.assignPolicyProgramBinder).not.toHaveBeenCalled();
    expect(result.current.selectedBinderId).toBe('');
    expect(result.current.selectedProgramId).toBe('');
  });

  it('pairs an operator-selected single-product binder with its only linked program', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [{
        id: 'binder-home',
        status: 'ACTIVE',
        productAuthorities: [{ productCode: 'HOME', status: 'ACTIVE' }],
      }],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [{
        id: 'program-home',
        status: 'ACTIVE',
        productType: 'HOME',
        binderLinks: [{ status: 'ACTIVE', binderId: 'binder-home' }],
      }],
    });

    const { result } = renderHook(() => usePolicyProgramsBinders(buildArgs({
      selectedPortfolio: { id: 'policy-home', productType: undefined },
      selectedPortfolioId: 'policy-home',
      currentProductLabel: '',
    })));

    await waitFor(() => expect(result.current.availableBinders).toHaveLength(1));
    act(() => result.current.setSelectedBinderId('binder-home'));

    await waitFor(() => expect(result.current.selectedProgramId).toBe('program-home'));
    await waitFor(() => expect(mocks.assignPolicyProgramBinder).toHaveBeenCalledWith(
      'policy-home',
      'program-home',
      'binder-home',
    ));
  });

  it('requires an explicit program selection for a multi-product binder', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [{
        id: 'binder-brit',
        status: 'ACTIVE',
        productAuthorities: [
          { productCode: 'TRAVEL', status: 'ACTIVE' },
          { productCode: 'HEALTH', status: 'ACTIVE' },
        ],
      }],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [
        { id: 'program-travel', status: 'ACTIVE', productType: 'TRAVEL', binderLinks: [{ status: 'ACTIVE', binderId: 'binder-brit' }] },
        { id: 'program-health', status: 'ACTIVE', productType: 'HEALTH', binderLinks: [{ status: 'ACTIVE', binderId: 'binder-brit' }] },
      ],
    });

    const { result } = renderHook(() => usePolicyProgramsBinders(buildArgs({
      selectedPortfolio: { id: 'policy-brit', productType: undefined },
      selectedPortfolioId: 'policy-brit',
      currentProductLabel: '',
    })));

    await waitFor(() => expect(result.current.availableBinders).toHaveLength(1));
    act(() => result.current.setSelectedBinderId('binder-brit'));

    await waitFor(() => expect(result.current.programs).toHaveLength(2));
    expect(result.current.selectedProgramId).toBe('');
    expect(mocks.assignPolicyProgramBinder).not.toHaveBeenCalled();
  });

  it('does not choose a multi-product binder program when replacing an existing product', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [
        { id: 'binder-travel', status: 'ACTIVE', productAuthorities: [{ productCode: 'TRAVEL', status: 'ACTIVE' }] },
        {
          id: 'binder-multi',
          status: 'ACTIVE',
          productAuthorities: [
            { productCode: 'HOME', status: 'ACTIVE' },
            { productCode: 'HEALTH', status: 'ACTIVE' },
          ],
        },
      ],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [
        { id: 'program-travel', status: 'ACTIVE', productType: 'TRAVEL', binderLinks: [{ status: 'ACTIVE', binderId: 'binder-travel' }] },
        { id: 'program-home', status: 'ACTIVE', productType: 'HOME', binderLinks: [{ status: 'ACTIVE', binderId: 'binder-multi' }] },
        { id: 'program-health', status: 'ACTIVE', productType: 'HEALTH', binderLinks: [{ status: 'ACTIVE', binderId: 'binder-multi' }] },
      ],
    });

    const { result } = renderHook(() => usePolicyProgramsBinders(buildArgs({
      selectedPortfolio: {
        id: 'policy-travel', productType: 'TRAVEL', programId: 'program-travel', binderId: 'binder-travel',
      },
      selectedPortfolioId: 'policy-travel',
    })));

    await waitFor(() => expect(result.current.selectedProgramId).toBe('program-travel'));
    act(() => result.current.setSelectedBinderId('binder-multi'));

    await waitFor(() => expect(result.current.selectedProgramId).toBe(''));
    expect(mocks.assignPolicyProgramBinder).not.toHaveBeenCalledWith(
      'policy-travel',
      expect.any(String),
      'binder-multi',
    );
  });

  it('does not auto-pair an authority that is not yet effective', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [{
        id: 'binder-future',
        status: 'ACTIVE',
        productAuthorities: [{ productCode: 'HOME', status: 'ACTIVE', effectiveFrom: '2099-01-01T00:00:00.000Z' }],
      }],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [{
        id: 'program-home', status: 'ACTIVE', productType: 'HOME', binderLinks: [{ status: 'ACTIVE', binderId: 'binder-future' }],
      }],
    });

    const { result } = renderHook(() => usePolicyProgramsBinders(buildArgs({
      selectedPortfolio: { id: 'policy-future', productType: undefined },
      selectedPortfolioId: 'policy-future',
      currentProductLabel: '',
    })));

    await waitFor(() => expect(result.current.availableBinders).toHaveLength(1));
    act(() => result.current.setSelectedBinderId('binder-future'));

    await waitFor(() => expect(result.current.selectedProgramId).toBe(''));
    expect(mocks.assignPolicyProgramBinder).not.toHaveBeenCalled();
  });

  it('flushes the pending operator assignment once before questionnaire send (ABY-470)', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [{
        id: 'binder-motor',
        status: 'ACTIVE',
        productAuthorities: [{ productCode: 'MOTOR', status: 'ACTIVE' }],
      }],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [{
        id: 'program-motor',
        status: 'ACTIVE',
        productType: 'MOTOR',
        binderLinks: [{ status: 'ACTIVE', binderId: 'binder-motor' }],
      }],
    });

    const { result } = renderHook(() => usePolicyProgramsBinders(buildArgs({
      selectedPortfolio: { id: 'policy-new', productType: undefined },
      selectedPortfolioId: 'policy-new',
      currentProductLabel: '',
    })));

    await waitFor(() => expect(result.current.availableBinders).toHaveLength(1));
    act(() => result.current.setSelectedBinderId('binder-motor'));
    await waitFor(() => expect(result.current.programs).toHaveLength(1));
    act(() => result.current.setSelectedProgramId('program-motor'));
    await waitFor(() => expect(result.current.selectedProgramId).toBe('program-motor'));

    await act(async () => {
      expect(await result.current.ensureProgramBinderAssigned(
        'policy-new',
        'program-motor',
        'binder-motor',
      )).toBe(true);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    expect(mocks.assignPolicyProgramBinder).toHaveBeenCalledTimes(1);
    expect(mocks.assignPolicyProgramBinder).toHaveBeenCalledWith(
      'policy-new',
      'program-motor',
      'binder-motor',
    );
  });

  it('persists an operator product switch away from Open Market (ABY-438)', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'binder-open-market',
          status: 'ACTIVE',
          productAuthorities: [{ productCode: 'OPEN_MARKET', status: 'ACTIVE' }],
        },
        {
          id: 'binder-motor',
          status: 'ACTIVE',
          productAuthorities: [{ productCode: 'MOTOR', status: 'ACTIVE' }],
        },
      ],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'program-open-market',
          status: 'ACTIVE',
          productType: 'OPEN_MARKET',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-open-market' }],
        },
        {
          id: 'program-motor',
          status: 'ACTIVE',
          productType: 'MOTOR',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-motor' }],
        },
      ],
    });

    const { result } = renderHook(() => usePolicyProgramsBinders(buildArgs({
      selectedPortfolio: {
        id: 'policy-om',
        productType: 'OPEN_MARKET',
        programId: 'program-open-market',
        binderId: 'binder-open-market',
      },
      selectedPortfolioId: 'policy-om',
      currentProductLabel: 'Open Market',
    })));

    await waitFor(() => expect(result.current.selectedBinderId).toBe('binder-open-market'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    mocks.assignPolicyProgramBinder.mockClear();

    await act(async () => {
      result.current.setSelectedBinderId('binder-motor');
    });

    await waitFor(() => expect(mocks.assignPolicyProgramBinder).toHaveBeenCalled());
    expect(mocks.assignPolicyProgramBinder).toHaveBeenCalledWith(
      'policy-om',
      'program-motor',
      'binder-motor',
    );
  });

  it('does not carry operator intent into a newly selected product-less draft', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'binder-open-market',
          status: 'ACTIVE',
          productAuthorities: [{ productCode: 'OPEN_MARKET', status: 'ACTIVE' }],
        },
        {
          id: 'binder-motor',
          status: 'ACTIVE',
          productAuthorities: [{ productCode: 'MOTOR', status: 'ACTIVE' }],
        },
      ],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'program-open-market',
          status: 'ACTIVE',
          productType: 'OPEN_MARKET',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-open-market' }],
        },
        {
          id: 'program-motor',
          status: 'ACTIVE',
          productType: 'MOTOR',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-motor' }],
        },
      ],
    });

    let args = buildArgs({
      selectedPortfolio: {
        id: 'policy-om',
        productType: 'OPEN_MARKET',
        programId: 'program-open-market',
        binderId: 'binder-open-market',
      },
      selectedPortfolioId: 'policy-om',
      currentProductLabel: 'Open Market',
    });
    const { result, rerender } = renderHook(() => usePolicyProgramsBinders(args));

    await waitFor(() => expect(result.current.selectedBinderId).toBe('binder-open-market'));
    await act(async () => {
      result.current.setSelectedBinderId('binder-motor');
    });
    await waitFor(() => expect(mocks.assignPolicyProgramBinder).toHaveBeenCalledWith(
      'policy-om',
      'program-motor',
      'binder-motor',
    ));

    mocks.assignPolicyProgramBinder.mockClear();
    args = buildArgs({
      selectedPortfolio: { id: 'policy-new', productType: undefined },
      selectedPortfolioId: 'policy-new',
      currentProductLabel: '',
    });
    rerender();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(mocks.assignPolicyProgramBinder).not.toHaveBeenCalled();
  });

  it('does not auto-reassign an Immigration/HEALTH policy onto Home or Business (ABY-436)', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'binder-home',
          status: 'ACTIVE',
          productAuthorities: [{ productCode: 'HOME', status: 'ACTIVE' }],
        },
        {
          id: 'binder-business',
          status: 'ACTIVE',
          productAuthorities: [{ productCode: 'BUSINESS', status: 'ACTIVE' }],
        },
        {
          id: 'binder-travel',
          status: 'ACTIVE',
          productAuthorities: [
            { productCode: 'TRAVEL', status: 'ACTIVE' },
            { productCode: 'HEALTH', status: 'ACTIVE' },
          ],
        },
      ],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'program-home',
          status: 'ACTIVE',
          productType: 'HOME',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-home' }],
        },
        {
          id: 'program-business',
          status: 'ACTIVE',
          productType: 'BUSINESS',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-business' }],
        },
        {
          id: 'program-health',
          status: 'ACTIVE',
          productType: 'HEALTH',
          binderLinks: [{ status: 'ACTIVE', binderId: 'binder-travel' }],
        },
      ],
    });

    renderHook(() => usePolicyProgramsBinders(buildArgs({
      selectedPortfolio: {
        id: 'policy-health',
        productType: 'HEALTH',
        programId: 'program-health',
        binderId: 'binder-travel',
      },
      selectedPortfolioId: 'policy-health',
      currentProductLabel: 'Immigration',
    })));

    await waitFor(() => expect(mocks.listBinders).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    const assignedPairs = mocks.assignPolicyProgramBinder.mock.calls.map(
      ([, programId, binderId]) => `${String(programId)}:${String(binderId)}`,
    );
    expect(assignedPairs.every((pair) => pair === 'program-health:binder-travel' || pair === '')).toBe(true);
    expect(assignedPairs.some((pair) => pair.startsWith('program-home:') || pair.startsWith('program-business:'))).toBe(false);
  });

  it('refreshes canonical policy identity after an operator switches a Motor quote to Home', async () => {
    mocks.listBinders.mockResolvedValue({
      success: true,
      data: [
        { id: 'binder-motor', status: 'ACTIVE', productAuthorities: [{ productCode: 'MOTOR', status: 'ACTIVE' }] },
        { id: 'binder-home', status: 'ACTIVE', productAuthorities: [{ productCode: 'HOME', status: 'ACTIVE' }] },
      ],
    });
    mocks.listPrograms.mockResolvedValue({
      success: true,
      data: [
        { id: 'program-motor', status: 'ACTIVE', productType: 'MOTOR', binderLinks: [{ status: 'ACTIVE', binderId: 'binder-motor' }] },
        { id: 'program-home', status: 'ACTIVE', productType: 'HOME', binderLinks: [{ status: 'ACTIVE', binderId: 'binder-home' }] },
      ],
    });

    const onAssignmentPersisted = vi.fn();
    const args = buildArgs({
      selectedPortfolio: { id: 'policy-1', productType: 'MOTOR', programId: 'program-motor', binderId: 'binder-motor' },
      onAssignmentPersisted,
    });
    const { result } = renderHook(() => usePolicyProgramsBinders(args));

    await waitFor(() => expect(result.current.selectedBinderId).toBe('binder-motor'));
    await act(async () => {
      result.current.setSelectedBinderId('binder-home');
    });
    await waitFor(() => expect(result.current.selectedProgramId).toBe('program-home'));

    await waitFor(() => expect(mocks.assignPolicyProgramBinder).toHaveBeenCalledWith(
      'policy-1',
      'program-home',
      'binder-home',
    ));
    expect(onAssignmentPersisted).toHaveBeenCalledTimes(1);
  });
});
