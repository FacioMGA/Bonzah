// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FacioCheckout } from './FacioCheckout';

const request = vi.hoisted(() => vi.fn());
vi.mock('./facioApi', async () => ({
  ...(await vi.importActual('./facioApi')),
  facioRequest: request,
}));
const intake = {
  title: 'Published rental form',
  currency: 'USD',
  initialQuoteData: { proposer: { insuredPartyType: 'PERSON' } },
  coverageAnswerPath: ['rental', 'coverages'],
  coverageQuestionKey: 'rental.coverages',
  coverageOptions: [
    {
      coverage: 'Damage',
      label: 'Damage',
      selectable: true,
      requires: [],
      termsMode: 'structured',
      benefitTerms: {
        schemaVersion: 1,
        benefits: [
          {
            id: 'damage',
            label: 'Vehicle damage',
            terms: [
              {
                id: 'max',
                label: 'Maximum',
                kind: 'limit',
                basis: 'per_event',
                value: { kind: 'money', amount: 35000, currency: 'USD' },
              },
            ],
          },
        ],
      },
    },
  ],
  questionnaire: {
    sections: [
      {
        id: 'renter',
        title: 'Renter details',
        questions: [
          {
            key: 'proposer.firstName',
            label: 'First name',
            type: 'text',
            answerPath: ['proposer', 'firstName'],
            required: true,
          },
          { key: 'vehicle.make', label: 'Make', type: 'text', answerPath: ['vehicle', 'make'] },
        ],
      },
    ],
  },
};
const quote = {
  quoteId: 'real-policy-id',
  receipt: 'encrypted-quote',
  status: 'QUOTED',
  bindable: true,
  premiumCalculated: 59.96,
  currency: 'USD',
  quoteResponse: {},
};
afterEach(() => {
  cleanup();
  request.mockReset();
});
describe('Live website checkout', () => {
  it('preserves prefill and changed answers in Summit quote; shows published terms without a bind action', async () => {
    request.mockResolvedValueOnce({ intake }).mockResolvedValueOnce(quote);
    render(
      <FacioCheckout
        channel="DISTRIBUTION"
        prefill={{ 'vehicle.make': 'Toyota' }}
        onBack={() => undefined}
      />,
    );
    const name = await screen.findByLabelText('First name');
    expect((screen.getByLabelText('Make') as HTMLInputElement).value).toBe('Toyota');
    expect(screen.getByText(/Maximum: \$35,000.00/)).toBeDefined();
    fireEvent.change(name, { target: { value: 'Synthetic Renter' } });
    fireEvent.click(screen.getByLabelText('Damage'));
    fireEvent.submit(screen.getByRole('button', { name: 'Get my quote' }).closest('form')!);
    await screen.findByText('Quote retained in Facio');
    expect(request.mock.calls[1][1]).toMatchObject({
      channel: 'DISTRIBUTION',
      quoteData: {
        proposer: { firstName: 'Synthetic Renter', insuredPartyType: 'PERSON' },
        vehicle: { make: 'Toyota' },
        rental: { coverages: [{ coverage: 'Damage' }] },
      },
    });
    expect(screen.queryByRole('button', { name: 'Review and continue' })).toBeNull();
  });
  it('reuses quote identity on unchanged retry and clears reviewed acceptance when answers change', async () => {
    request
      .mockResolvedValueOnce({ intake })
      .mockRejectedValueOnce(new Error('Timeout; retry unchanged'))
      .mockResolvedValueOnce(quote)
      .mockResolvedValueOnce({
        receipt: 'reviewed-receipt',
        review: {
          premium: 59.96,
          currency: 'USD',
          offerId: 'retained-offer',
          quoteVersionId: 'retained-version',
          paymentMode: 'SIMULATED',
        },
      });
    render(
      <FacioCheckout
        channel="DIRECT"
        prefill={{ 'proposer.firstName': 'Synthetic' }}
        onBack={() => undefined}
      />,
    );
    await screen.findByLabelText('First name');
    fireEvent.submit(screen.getByRole('button', { name: 'Get my quote' }).closest('form')!);
    await screen.findByText('Timeout; retry unchanged');
    fireEvent.submit(screen.getByRole('button', { name: 'Get my quote' }).closest('form')!);
    await screen.findByText('Quote retained in Facio');
    expect(request.mock.calls[1][2]).toBe(request.mock.calls[2][2]);
    fireEvent.click(screen.getByRole('button', { name: 'Review and continue' }));
    const bind = await screen.findByRole('button', { name: 'Bind demonstration policy' });
    expect((bind as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I confirm these details/));
    expect((bind as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Changed' } });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Bind demonstration policy' })).toBeNull(),
    );
    expect(request.mock.calls.filter(([, body]) => body?.action === 'complete')).toHaveLength(0);
  });
});
