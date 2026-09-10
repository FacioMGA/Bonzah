/* @vitest-environment happy-dom */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ManualProposalEditor } from './ManualProposalEditor';
import { asRecord, type UnknownRecord } from '../../../../shared/lib/record';

function renderComponent(
  qd: UnknownRecord = { proposer: { email: 'client@example.com' } },
  productType?: string,
  options: { coverageSelection?: unknown; lockedMarketName?: string; onSendToClient?: () => void | Promise<void>; premiumLocked?: boolean } = {},
) {
  const patchQuoteData = vi.fn();
  const onRecalculate = vi.fn();
  render(
    <ManualProposalEditor
      qd={qd}
      productType={productType}
      coverageSelection={options.coverageSelection}
      lockedMarketName={options.lockedMarketName}
      currency="EUR"
      premiumLocked={options.premiumLocked ?? false}
      patchQuoteData={patchQuoteData}
      onRecalculate={onRecalculate}
      isReRating={false}
      onSendToClient={options.onSendToClient}
      isSendingToClient={false}
    />,
  );
  return { patchQuoteData, onRecalculate };
}

describe('ManualProposalEditor', () => {
  it('saves manual coverage rows and total premium into quoteData', async () => {
    const { patchQuoteData } = renderComponent();

    fireEvent.change(screen.getByLabelText('Market / insurer'), { target: { value: 'Manual Market' } });
    fireEvent.change(screen.getByPlaceholderText('Public liability'), { target: { value: 'Public liability' } });
    fireEvent.change(screen.getByPlaceholderText('1,000,000'), { target: { value: '1000000' } });
    fireEvent.change(screen.getByPlaceholderText('500'), { target: { value: '1000' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '60000' } });
    expect(screen.getByLabelText('Limit 1')).toHaveValue('1,000,000');
    expect(screen.getByLabelText('Excess 1')).toHaveValue('1,000');
    expect(screen.getByLabelText('Premium 1')).toHaveValue('60,000');
    expect(screen.queryByRole('button', { name: 'Save proposal' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save and recalculate' }));

    await waitFor(() => expect(patchQuoteData).toHaveBeenCalledTimes(1));
    const payload = asRecord(patchQuoteData.mock.calls[0]?.[0]);
    const proposal = asRecord(payload.proposal);
    const rows = Array.isArray(proposal.coverageRows) ? proposal.coverageRows.map(asRecord) : [];

    expect(payload.manualPremium).toBe(60000);
    expect(proposal.marketName).toBe('Manual Market');
    expect(rows).toEqual([
      expect.objectContaining({
        coverage: 'Public liability',
        limit: '1,000,000',
        excess: '1,000',
        premium: 60000,
      }),
    ]);
  });

  it('saves UW adjustments into quoteData and includes them in manual premium', async () => {
    const { patchQuoteData } = renderComponent();

    fireEvent.change(screen.getByLabelText('Market / insurer'), { target: { value: 'Manual Market' } });
    fireEvent.change(screen.getByPlaceholderText('Public liability'), { target: { value: 'Public liability' } });
    fireEvent.change(screen.getByPlaceholderText('1,000,000'), { target: { value: '1000000' } });
    fireEvent.change(screen.getByPlaceholderText('500'), { target: { value: '500' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add adjustment' }));
    fireEvent.change(screen.getByLabelText('Adjustment type 1'), { target: { value: 'loading' } });
    fireEvent.change(screen.getByLabelText('Adjustment value 1'), { target: { value: '250' } });
    fireEvent.change(screen.getByLabelText('Adjustment reason 1'), { target: { value: 'Higher risk occupancy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and recalculate' }));

    await waitFor(() => expect(patchQuoteData).toHaveBeenCalledTimes(1));
    const payload = asRecord(patchQuoteData.mock.calls[0]?.[0]);
    const adjustments = Array.isArray(payload.uwAdjustments) ? payload.uwAdjustments.map(asRecord) : [];

    expect(payload.manualPremium).toBe(1250);
    expect(adjustments[0]).toMatchObject({
      lineType: 'pricing',
      type: 'loading',
      mode: 'amount',
      value: 250,
      reasonText: 'Higher risk occupancy',
    });
  });

  it('recalculates with the freshly saved proposal rows', async () => {
    const { onRecalculate } = renderComponent();

    fireEvent.change(screen.getByLabelText('Market / insurer'), { target: { value: 'Manual Market' } });
    fireEvent.change(screen.getByPlaceholderText('Public liability'), { target: { value: 'Property cover' } });
    fireEvent.change(screen.getByPlaceholderText('1,000,000'), { target: { value: '1000000' } });
    fireEvent.change(screen.getByPlaceholderText('500'), { target: { value: '500' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '60000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and recalculate' }));

    await waitFor(() => expect(onRecalculate).toHaveBeenCalledTimes(1));
    const payload = asRecord(onRecalculate.mock.calls[0]?.[0]);
    const proposal = asRecord(payload.proposal);
    const rows = Array.isArray(proposal.coverageRows) ? proposal.coverageRows.map(asRecord) : [];

    expect(rows[0]).toMatchObject({
      coverage: 'Property cover',
      limit: '1,000,000',
      excess: '500',
      premium: 60000,
    });
    expect(payload.manualPremium).toBe(60000);
  });

  it('seeds Business proposal rows from customer requested coverages', () => {
    renderComponent(
      {
        coverage: {
          publicLiability: 'yes',
          publicLiabilityLimit: 1000000,
          businessInterruption: 'yes',
          businessInterruptionLimit: 75000,
          businessInterruptionIndemnityMonths: 12,
          legalAssistance: 'yes',
        },
      },
      'BUSINESS',
    );

    expect(screen.getByDisplayValue('Public liability')).toBeTruthy();
    expect(screen.getByDisplayValue('1,000,000')).toBeTruthy();
    expect(screen.getByText(/Premiums are entered by the underwriter and totaled from the rows/)).toBeTruthy();
    expect(screen.getByText('Rows plus UW adjustments')).toBeTruthy();
    expect(screen.getByDisplayValue('Business interruption')).toBeTruthy();
    expect(screen.getByDisplayValue('75,000')).toBeTruthy();
    expect(screen.getByDisplayValue('Legal assistance')).toBeTruthy();
    expect(screen.getByLabelText('Limit 3')).toHaveTextContent('Included');
    expect(screen.queryByText('Sync from questionnaire')).toBeNull();
    expect(screen.queryByText('From questionnaire')).toBeNull();
  });

  it('persists complete proposals as ready to send before a client proposal can be sent', async () => {
    const { patchQuoteData } = renderComponent(
      {
        proposal: {
          status: 'draft',
        },
        coverage: {
          publicLiability: 'yes',
          publicLiabilityLimit: 1000000,
        },
      },
      'BUSINESS',
    );

    fireEvent.change(screen.getByLabelText('Market / insurer'), { target: { value: 'Manual Market' } });
    fireEvent.change(screen.getByLabelText('Excess 1'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Premium 1'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and recalculate' }));

    await waitFor(() => expect(patchQuoteData).toHaveBeenCalledTimes(1));
    const payload = asRecord(patchQuoteData.mock.calls[0]?.[0]);
    const proposal = asRecord(payload.proposal);
    expect(screen.getByLabelText('Proposal status')).toHaveTextContent('Ready to send');
    expect(proposal.status).toBe('ready_to_send');
    expect(payload.manualPremium).toBe(250);
  });

  it('adds newly selected Coverage-tab rows to existing saved proposal rows', () => {
    renderComponent(
      {
        coverage: {
          publicLiability: 'yes',
          publicLiabilityLimit: 1000000,
        },
        proposal: {
          coverageRows: [
            {
              code: 'BUSINESS-PUBLIC-LIABILITY',
              coverage: 'Public liability',
              limit: '1,000,000',
              excess: '500',
              premium: 250,
              notes: 'Saved terms',
              source: 'questionnaire',
            },
          ],
        },
      },
      'BUSINESS',
      { coverageSelection: { selected: { 'BUSINESS-LEGAL-ASSISTANCE': true } } },
    );

    expect(screen.getByDisplayValue('Public liability')).toBeTruthy();
    expect(screen.getByDisplayValue('Legal assistance')).toBeTruthy();
  });

  it('locks market to the selected binder/program and saves that market', async () => {
    const { patchQuoteData } = renderComponent(
      {
        coverage: {
          publicLiability: 'yes',
          publicLiabilityLimit: 1000000,
        },
      },
      'BUSINESS',
      { lockedMarketName: 'Open Market Binder / Business' },
    );

    expect(screen.getByLabelText('Market / insurer')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Excess 1'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Premium 1'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and recalculate' }));

    await waitFor(() => expect(patchQuoteData).toHaveBeenCalledTimes(1));
    const proposal = asRecord(asRecord(patchQuoteData.mock.calls[0]?.[0]).proposal);
    expect(proposal.marketName).toBe('Open Market Binder / Business');
  });

  it('saves the manual proposal before sending it to the client', async () => {
    const onSendToClient = vi.fn();
    const { patchQuoteData } = renderComponent(
      {
        coverage: {
          publicLiability: 'yes',
          publicLiabilityLimit: 1000000,
        },
      },
      'BUSINESS',
      { lockedMarketName: 'Open Market Binder / Business', onSendToClient },
    );

    fireEvent.change(screen.getByLabelText('Excess 1'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Premium 1'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to client' }));

    await waitFor(() => expect(onSendToClient).toHaveBeenCalledTimes(1));
    expect(patchQuoteData).toHaveBeenCalledTimes(1);
    const proposal = asRecord(asRecord(patchQuoteData.mock.calls[0]?.[0]).proposal);
    const rows = Array.isArray(proposal.coverageRows) ? proposal.coverageRows.map(asRecord) : [];
    expect(rows[0]).toMatchObject({ coverage: 'Public liability', excess: '500', premium: 250 });
    expect(proposal.status).toBe('ready_to_send');
  });

  it('requires a reason before sending a non-zero UW adjustment', async () => {
    const onSendToClient = vi.fn();
    renderComponent(
      {
        coverage: {
          publicLiability: 'yes',
          publicLiabilityLimit: 1000000,
        },
      },
      'BUSINESS',
      { lockedMarketName: 'Open Market Binder / Business', onSendToClient },
    );

    fireEvent.change(screen.getByLabelText('Excess 1'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Premium 1'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add adjustment' }));
    fireEvent.change(screen.getByLabelText('Adjustment value 1'), { target: { value: '25' } });

    expect(screen.getByRole('button', { name: 'Send to client' })).toBeDisabled();
    expect(screen.getByText('Add reason for UW adjustment')).toBeTruthy();
  });

  it('renders the accepted client proposal as read-only when locked', () => {
    renderComponent(
      {
        proposal: {
          marketName: 'Open Market Binder / Business',
          coverageRows: [
            { coverage: 'Public liability', limit: '1,000,000', excess: '500', premium: 250 },
          ],
        },
      },
      'BUSINESS',
      { premiumLocked: true, onSendToClient: vi.fn() },
    );

    expect(screen.getByText(/proposal is locked because the client has approved it/i)).toBeTruthy();
    expect(screen.getByLabelText('Market / insurer')).toBeDisabled();
    expect(screen.getByLabelText('Coverage 1')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save and recalculate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send to client' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
  });
});
