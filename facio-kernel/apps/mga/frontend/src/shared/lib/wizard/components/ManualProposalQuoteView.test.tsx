/* @vitest-environment happy-dom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ManualProposalQuoteView } from './ManualProposalQuoteView';

vi.mock('../steps/PaymentCapabilityGate', () => ({
  PaymentStep: () => <div>Mock CardCorp payment module</div>,
}));

describe('ManualProposalQuoteView', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('renders a customer-facing manual proposal with pricing rows', () => {
    render(
      <ManualProposalQuoteView
        productLabel="business insurance"
        currency="EUR"
        quoteResponse={{ reference: 'ABQ-1' }}
        quoteData={{
          proposer: { firstName: 'Business', lastName: 'Test' },
          manualPremium: 4000,
          proposal: {
            marketName: 'Open Market / Business',
            termsNotes: 'Subject to signed proposal form.',
            coverageRows: [
              {
                coverage: 'Public liability',
                limit: '1,000,000',
                excess: '500',
                premium: 2000,
                notes: 'Included terms',
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText('Your business insurance proposal')).toBeTruthy();
    expect(screen.getByText('Public liability')).toBeTruthy();
    expect(screen.getAllByText('EUR 2,000.00')[0]).toBeTruthy();
    expect(screen.getByText('EUR 4,000.00')).toBeTruthy();
    expect(screen.getByText('Subject to signed proposal form.')).toBeTruthy();
  });

  it('requires proposal acceptance before showing the shared payment module', () => {
    render(
      <ManualProposalQuoteView
        productLabel="business insurance"
        currency="EUR"
        productCode="business"
        publicSessionToken="public-token-1"
        quoteResponse={{ reference: 'ABQ-1' }}
        quoteData={{
          proposer: { firstName: 'Business', lastName: 'Test' },
          manualPremium: 4000,
          proposal: {
            marketName: 'Open Market / Business',
            coverageRows: [{ coverage: 'Public liability', premium: 4000 }],
          },
        }}
      />,
    );

    const approveButton = screen.getByRole('button', { name: 'Approve and pay' });
    expect(approveButton).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/I accept this proposal/i));
    expect(approveButton).toBeEnabled();
    fireEvent.click(approveButton);

    expect(screen.getByText('Mock CardCorp payment module')).toBeTruthy();
  });

  it('opens the payment module directly on CardCorp return step', () => {
    window.history.replaceState(null, '', '/quote/session-token?product=business&step=payment&id=checkout-1');

    render(
      <ManualProposalQuoteView
        productLabel="business insurance"
        currency="EUR"
        productCode="business"
        publicSessionToken="public-token-1"
        quoteResponse={{ reference: 'ABQ-1' }}
        quoteData={{
          proposer: { firstName: 'Business', lastName: 'Test' },
          manualPremium: 4000,
          proposal: {
            marketName: 'Open Market / Business',
            coverageRows: [{ coverage: 'Public liability', premium: 4000 }],
          },
        }}
      />,
    );

    expect(screen.getByText('Mock CardCorp payment module')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and pay' })).toBeNull();
  });
});
