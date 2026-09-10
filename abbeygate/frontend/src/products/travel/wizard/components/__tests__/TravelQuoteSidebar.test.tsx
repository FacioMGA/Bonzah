/* @vitest-environment happy-dom */
/**
 * ADR-0035 — the 2% underwriting profit loading ("Premium adjustment")
 * is part of the price the customer pays. It was silently dropped from
 * the order-summary sidebar because the line-kind union did not include
 * `'loading'`, so the displayed rows no longer added up to the total
 * (adding a +€10 add-on appeared to raise the total by ~€11). This locks
 * the contract: a `loading` line renders in the charges block.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TravelQuoteSidebar } from '../TravelQuoteSidebar';

describe('TravelQuoteSidebar', () => {
  it('renders the Premium adjustment (loading) line so the breakdown reconciles', () => {
    render(
      <TravelQuoteSidebar
        areaLabel="Europe"
        coverLevelLabel="Silver Single Trip"
        coveringLabel="Individual"
        startDate="01/07/2026"
        endDate="14/07/2026"
        breakdownLines={[
          { code: 'base', label: 'Base premium', amount: 100, kind: 'base' },
          { code: 'addon.golfCover', label: 'Golf cover', amount: 10, kind: 'addon' },
          { code: 'loading.uwProfit', label: 'Premium adjustment', amount: 2.2, kind: 'loading' },
          { code: 'tax.ipt', label: 'Insurance premium tax', amount: 10.1, kind: 'tax' },
          { code: 'fee.admin', label: 'Admin fee', amount: 7, kind: 'fee' },
          { code: 'total', label: 'Total', amount: 129.3, kind: 'total' },
        ]}
      />,
    );

    expect(screen.getByText('Premium adjustment')).toBeInTheDocument();
    expect(screen.getByText('€2.20')).toBeInTheDocument();
  });
});
