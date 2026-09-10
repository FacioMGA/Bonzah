// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { IssuedPremiumSummary } from './PremiumTab';

afterEach(cleanup);

it('shows the retained assistance fee once without changing the retained payable premium', () => {
  const primary = {
    annualPremium: 293.39,
    breakdown: { netPremium: 263.39, adminFee: 18, iptAmount: 0, europAssistanceFee: 12, grossPremium: 293.39 },
  };
  render(<IssuedPremiumSummary primary={primary} cost={{ subtotalNetPremium: 263.39 }} currency="EUR" />);
  const row = screen.getByText('Home Emergency Assistance Fee').closest('tr');
  expect(within(row!).getByText('€12.00')).toBeInTheDocument();
  expect(screen.getAllByText('Admin fee')).toHaveLength(1);
  expect(screen.getByText('€18.00')).toBeInTheDocument();
  expect(screen.getByText('€263.39')).toBeInTheDocument();
  expect(screen.getByText('€ 293.39')).toBeInTheDocument();
  expect(primary.breakdown.grossPremium).toBe(293.39);
});

it('keeps canonical lines authoritative and does not add a second fee from legacy fields', () => {
  render(<IssuedPremiumSummary currency="EUR" cost={{}} primary={{ breakdown: {
    europAssistanceFee: 12,
    lines: [
      { code: 'assistance', label: 'Retained assistance charge', amount: 12, kind: 'fee' },
      { code: 'total', label: 'Total payable', amount: 293.39, kind: 'total' },
    ],
  } }} />);
  expect(screen.getByText('Retained assistance charge')).toBeInTheDocument();
  expect(screen.queryByText('Home Emergency Assistance Fee')).not.toBeInTheDocument();
  expect(screen.getAllByText('€12.00')).toHaveLength(1);
});

it('does not imply an assistance charge when the retained fee is absent or zero', () => {
  const view = render(<IssuedPremiumSummary primary={{ annualPremium: 281.39, breakdown: { netPremium: 263.39, adminFee: 18 } }} cost={{}} currency="EUR" />);
  expect(screen.queryByText('Home Emergency Assistance Fee')).not.toBeInTheDocument();
  view.rerender(<IssuedPremiumSummary primary={{ annualPremium: 281.39, breakdown: { netPremium: 263.39, adminFee: 18, europAssistanceFee: 0 } }} cost={{}} currency="EUR" />);
  expect(screen.queryByText('Home Emergency Assistance Fee')).not.toBeInTheDocument();
});
