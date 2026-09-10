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

const collectionIntake = {
  ...intake,
  questionnaire: {
    sections: [
      {
        id: 'people',
        title: 'Additional drivers',
        questions: [
          {
            key: 'drivers',
            label: 'Named drivers',
            type: 'list',
            answerPath: ['drivers'],
            sourceCollection: {
              key: 'drivers',
              itemLabel: 'Driver',
              minimumItems: 0,
              maximumItems: 20,
              fields: [
                {
                  key: 'fullName',
                  label: 'Full name',
                  type: 'text',
                  answerPath: ['fullName'],
                  requiredAtStages: ['quote'],
                },
                {
                  key: 'named',
                  label: 'Named on agreement',
                  type: 'boolean',
                  answerPath: ['named'],
                  requiredAtStages: ['quote'],
                },
              ],
            },
          },
        ],
      },
    ],
  },
};
describe('Configured collection controls', () => {
  it('allows an empty optional collection, validates each row, and preserves explicit false on removal', async () => {
    request.mockResolvedValueOnce({ intake: collectionIntake }).mockResolvedValue(quote);
    render(<FacioCheckout channel="DISTRIBUTION" prefill={{}} onBack={() => undefined} />);
    const add = await screen.findByRole('button', { name: 'Add driver' });
    expect(
      (screen.getByRole('button', { name: 'Get my quote' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.submit(screen.getByRole('button', { name: 'Get my quote' }).closest('form')!);
    await screen.findByText('Quote retained in Facio');
    fireEvent.click(add);
    fireEvent.submit(screen.getByRole('button', { name: 'Get my quote' }).closest('form')!);
    await screen.findByText(/Driver 1: Full name is required/);
    expect(request).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: 'User-entered name' },
    });
    fireEvent.change(screen.getByLabelText('Named on agreement'), { target: { value: 'false' } });
    fireEvent.click(add);
    fireEvent.click(screen.getByRole('button', { name: 'Remove driver 2' }));
    fireEvent.submit(screen.getByRole('button', { name: 'Get my quote' }).closest('form')!);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(request.mock.calls[2][1].quoteData.drivers).toEqual([
      { fullName: 'User-entered name', named: false },
    ]);
  });
  it('uses the published maximum bound, allowing add again only after removal', async () => {
    request.mockResolvedValueOnce({ intake: collectionIntake });
    render(<FacioCheckout channel="DISTRIBUTION" prefill={{}} onBack={() => undefined} />);
    const add = await screen.findByRole('button', { name: 'Add driver' });
    for (let i = 0; i < 20; i++) fireEvent.click(add);
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByLabelText('Full name')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: 'Remove driver 20' }));
    expect((add as HTMLButtonElement).disabled).toBe(false);
  });
  it('updates the exact timestamp date while preserving an explicitly entered time and offset', async () => {
    const next = {
      ...intake,
      questionnaire: {
        sections: [
          {
            id: 'period',
            title: 'Rental period',
            questions: [
              {
                key: 'policy.endDate',
                label: 'Return date',
                type: 'date',
                answerPath: ['policy', 'endDate'],
              },
              {
                key: 'policy.endAt',
                label: 'Return time',
                type: 'text',
                answerPath: ['policy', 'endAt'],
                exactTime: { dateAnswerPath: ['policy', 'endDate'], timeZone: 'America/Denver' },
              },
            ],
          },
        ],
      },
    };
    request.mockResolvedValueOnce({ intake: next }).mockResolvedValue(quote);
    render(
      <FacioCheckout
        channel="DISTRIBUTION"
        prefill={{ 'policy.endDate': '2026-09-22', 'policy.endAt': '2026-09-22T10:00:00-06:00' }}
        onBack={() => undefined}
      />,
    );
    await screen.findByLabelText('Return date');
    fireEvent.change(screen.getByLabelText('Return time'), {
      target: { value: '2026-09-22T11:45:00-07:00' },
    });
    fireEvent.change(screen.getByLabelText('Return date'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Return date'), { target: { value: '24/09/2026' } });
    expect((screen.getByLabelText('Return time') as HTMLInputElement).value).toBe(
      '2026-09-24T11:45:00-07:00',
    );
    fireEvent.submit(screen.getByRole('button', { name: 'Get my quote' }).closest('form')!);
    await screen.findByText('Quote retained in Facio');
    expect(request.mock.calls[1][1].quoteData.policy).toEqual({
      endDate: '2026-09-24',
      endAt: '2026-09-24T11:45:00-07:00',
    });
  });
});
