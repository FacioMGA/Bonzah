/* @vitest-environment happy-dom */

/**
 * Regression suite for `ABBEYGATE-REACT-6` —
 *   `TypeError: Cannot read properties of undefined (reading 'maxAdvanceInceptionDays')`
 *
 * The previous revision of `BinderCreateEditView` rendered structured
 * "Authority" and "Financials and Documentation" sections that read
 * `binder.config.authority.*` / `binder.config.financials.*` JSON keys.
 * The shape was hardcoded for the legacy Cyprus Motor binder. Any binder
 * seeded by `backend/modules/policy/app/binders/canonicalProgramBinderSeed.ts`
 * (HOME-*, TRAVEL-*, HEALTH-*) has `config = { productType, scope }` only —
 * those structured reads threw on render and the user saw the global
 * `SessionAwareErrorBoundary` instead of the form.
 *
 * The contract fix removes the structured sections (their canonical owner
 * is `BinderProductAuthority`, edited via `AuthorizedProductsPanel`).
 * This file pins the contract:
 *
 *   1. The form renders without throwing for any binder config shape:
 *      sparse (TRAVEL-25EEA6153 shape today), legacy CY Motor (full
 *      `BinderConfig`), and totally empty `{}`.
 *   2. The "Authority" SectionCard MUST NOT come back. Re-introducing
 *      structured authority editing here re-creates the canonical-ownership
 *      drift that produced REACT-6 in the first place.
 *   3. Save passes the textarea JSON through verbatim — it does not patch
 *      `config.agreement.*` from the form fields (the previous
 *      `syncCoreAgreementConfig` helper was Cyprus-Motor-specific and
 *      crashed on any sparse config when Save was pressed).
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { BinderCreateEditView } from './BinderCreateEditView';
import type { BinderDetailBundle } from '../model/readModels';

function makeBundle(config: Record<string, unknown>): BinderDetailBundle {
  return {
    binder: {
      id: 'TRAVEL-25EEA6153',
      coverholderName: 'Abbeygate Insurance Brokers Limited',
      coverholderPin: '115933OFE',
      umr: 'B176025EEA6153',
      agreementNumber: '25EEA6153',
      lloydsReportingVer: 'V52',
      defaultCurrency: 'EUR',
      settlementCurrency: 'EUR',
      status: 'ACTIVE',
      startDate: '2025-11-15T00:00:00.000Z',
      endDate: '2026-11-14T23:59:59.999Z',
      version: 1,
      etag: null,
      config,
      createdAt: null,
      updatedAt: null,
    },
    parties: [],
    documents: [],
    coverages: [],
    clauses: [],
    financials: null,
    reporting: null,
    programLinks: [],
  };
}

const SPARSE_TRAVEL_CONFIG: Record<string, unknown> = {
  productType: 'TRAVEL',
  scope: { authorizedClass: 'Travel', riskLocationCountries: ['CY', 'ES', 'PT', 'GR'] },
};

const LEGACY_MOTOR_CONFIG: Record<string, unknown> = {
  agreement: {
    agreementNumber: '23EEA6152',
    umr: 'B176023EEA6152',
    status: 'ACTIVE',
    period: { inceptionDate: '2023-03-31T00:00:00.000Z', expiryDate: '2024-03-30T00:00:00.000Z' },
    coverholders: [{ name: 'Facio Insurance Brokers Limited', role: 'Primary' }],
    lloydsBroker: { name: 'ARB Europe Ltd' },
  },
  authority: {
    authorizedClasses: ['TPBI', 'TPPD', 'OD'],
    territorialLimits: ['Cyprus'],
    maxAdvanceInceptionDays: 90,
    maxPolicyPeriodMonths: 15,
    limitsOfLiability: { default: { materialDamageMax: 250000, currency: 'EUR' } },
  },
  financials: {
    grossPremiumIncomeLimit: 2000000,
    currency: 'EUR',
    warningThresholdPercentage: 85,
    coverholderCommissionRate: 30,
    brokerageRate: 0,
    profitCommissionRate: 20,
    premiumTaxRate: 0,
  },
};

function renderView(initial: BinderDetailBundle | null, onSubmit = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/configure/binders/TRAVEL-25EEA6153/edit']}>
      <BinderCreateEditView
        mode={initial ? 'edit' : 'create'}
        initial={initial}
        onSubmit={onSubmit}
        saving={false}
        error=""
      />
    </MemoryRouter>,
  );
}

describe('BinderCreateEditView — REACT-6 regression', () => {
  beforeEach(() => {
    // happy-dom resets are handled by `cleanup` in `afterEach`; nothing to set up.
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without throwing for a sparse TRAVEL binder (canonical seed shape)', () => {
    expect(() => renderView(makeBundle(SPARSE_TRAVEL_CONFIG))).not.toThrow();
    // Core agreement values come from top-level binder columns, not from `config.*`.
    expect(screen.getByDisplayValue('Abbeygate Insurance Brokers Limited')).toBeTruthy();
    expect(screen.getByDisplayValue('25EEA6153')).toBeTruthy();
  });

  it('renders without throwing for a legacy Cyprus Motor binder (full BinderConfig shape)', () => {
    expect(() => renderView(makeBundle(LEGACY_MOTOR_CONFIG))).not.toThrow();
  });

  it('renders without throwing for an empty config `{}`', () => {
    expect(() => renderView(makeBundle({}))).not.toThrow();
  });

  it('renders without throwing when initial is null (create mode)', () => {
    expect(() => renderView(null)).not.toThrow();
    expect(screen.getByText('Create Binder')).toBeTruthy();
  });

  it('does NOT render a structured Authority section (canonical-ownership lock)', () => {
    renderView(makeBundle(SPARSE_TRAVEL_CONFIG));
    // The previous "Authority" SectionCard had a heading by that exact name and
    // four numeric inputs (Max advance inception days, Max policy term, Coverholder 1 max
    // material damage, Coverholder 2 max material damage). All of those are now
    // forbidden in this view — they belong to `BinderProductAuthority` (per-product
    // canonical store) and are edited via `AuthorizedProductsPanel`.
    expect(screen.queryByText(/^Authority$/)).toBeNull();
    expect(screen.queryByPlaceholderText(/Max advance inception days/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/Max policy term/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/Coverholder 1 max material damage/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/Coverholder 2 max material damage/i)).toBeNull();
  });

  it('passes the textarea JSON through to onSubmit verbatim (no Cyprus-Motor patching)', () => {
    const onSubmit = vi.fn();
    renderView(makeBundle(SPARSE_TRAVEL_CONFIG), onSubmit);

    fireEvent.click(screen.getByText('Save'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    // Top-level binder columns come from the form state (seeded from
    // `initial.binder.{coverholderName, agreementNumber, status, startDate, endDate}`).
    expect(payload.coverholderName).toBe('Abbeygate Insurance Brokers Limited');
    expect(payload.agreementNumber).toBe('25EEA6153');
    expect(payload.status).toBe('ACTIVE');
    // Config is whatever the textarea contained — the original sparse JSON.
    // Critically, `config.agreement.*` is NOT injected from the form; that was the
    // legacy `syncCoreAgreementConfig` behaviour which crashed on sparse configs.
    expect(payload.config).toEqual(SPARSE_TRAVEL_CONFIG);
  });

  it('rejects Save with an inline error when the textarea is not a JSON object', () => {
    const onSubmit = vi.fn();
    renderView(makeBundle(SPARSE_TRAVEL_CONFIG), onSubmit);

    const textarea = screen.getByPlaceholderText('{}') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'not-json' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onSubmit).not.toHaveBeenCalled();
    // The local error surface uses the same inline card the API error uses.
    // We assert the literal substring from the JSON parse error to avoid
    // matching the "Binder Config (JSON)" section title that legitimately
    // contains "JSON".
    expect(screen.getByText(/not valid JSON/i)).toBeTruthy();
  });

  it('rejects Save with an inline error when the textarea is a JSON array', () => {
    const onSubmit = vi.fn();
    renderView(makeBundle(SPARSE_TRAVEL_CONFIG), onSubmit);

    const textarea = screen.getByPlaceholderText('{}') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '[]' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onSubmit).not.toHaveBeenCalled();
    // Anti-defensive-fallback contract: refuse to coerce a JSON array into
    // an object — produce an explicit configuration failure instead.
    expect(screen.getByText(/Binder config must be a JSON object/i)).toBeTruthy();
  });
});
