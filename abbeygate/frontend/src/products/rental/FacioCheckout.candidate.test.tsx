// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FacioCheckout } from './FacioCheckout';
import { rentalPrefill } from './rentalPrefill';
import { type FacioIntake, readAnswer } from './facioApi';
import fixture from './__tests__/fixtures/bonzah-native-intake.offline.json';
import { candidateFormValues } from './__tests__/candidateFormValues';

// Unmodified output of Facio's actual projector, SHA256 ad4ec46383be6c499f00442b1ce311dcf4fb3be8a7536fc52f28852d58b7820a.
// Source 887e0421; OFFLINE_UNBOUND IDs are not customer publication or live quote evidence.
const intake = fixture.data as FacioIntake;
const request = vi.hoisted(() => vi.fn());
vi.mock('./facioApi', async () => ({
  ...(await vi.importActual('./facioApi')),
  facioRequest: request,
}));
const prefill = rentalPrefill({
  pickupState: 'CO',
  residenceState: 'CA',
  location: 'Denver International Airport',
  start: '2026-09-18',
  end: '2026-09-22',
  startTime: '10:00',
  endTime: '10:00',
});
const fields = intake.questionnaire.sections.flatMap((section) => section.questions);
afterEach(() => {
  cleanup();
  request.mockReset();
});
async function mount(channel: 'DIRECT' | 'DISTRIBUTION') {
  request.mockResolvedValueOnce({ intake }).mockResolvedValue({
    quoteId: 'OFFLINE_TRANSPORT_QUOTE',
    status: 'QUOTED',
    bindable: true,
    receipt: 'OFFLINE_TRANSPORT_RECEIPT',
    currency: 'USD',
    premiumCalculated: 131.84,
  });
  const view = render(
    <FacioCheckout channel={channel} prefill={prefill} onBack={() => undefined} />,
  );
  await screen.findByRole('button', { name: 'Add driver' });
  expect(request.mock.calls[0]).toEqual([`/api/quote?channel=${channel}`]);
  const control = (key: string) =>
    view.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${key}"]`)!;
  for (const [key, value] of Object.entries(candidateFormValues)) {
    expect(control(key), key).not.toBeNull();
    fireEvent.change(control(key), { target: { value } });
  }
  for (const coverage of intake.coverageOptions)
    fireEvent.click(screen.getByLabelText(coverage.label));
  return { ...view, control };
}
describe('Actual offline native Bonzah intake compatibility', () => {
  it('renders every scalar source/native field and emits exact nested/literal paths for Summit with zero additional drivers', async () => {
    const view = await mount('DISTRIBUTION');
    expect(fields).toHaveLength(40);
    for (const field of fields.filter(
      (field) => !field.sourceCollection && field.key !== intake.coverageQuestionKey,
    ))
      expect(view.control(field.key), field.key).not.toBeNull();
    expect(view.control('residence.state').value).toBe('CA');
    expect(view.control('proposer.address.state').value).toBe('CA');
    fireEvent.change(view.control('residence.state'), { target: { value: 'NY' } });
    fireEvent.change(view.control('vehicle.trim'), { target: { value: 'User edited trim' } });
    expect(view.control('residence.state').value).toBe('NY');
    expect(view.control('proposer.address.state').value).toBe('CA');
    fireEvent.submit(screen.getByRole('button', { name: 'Get my quote' }).closest('form')!);
    await screen.findByText('Quote retained in Facio');
    const { quoteData, channel } = request.mock.calls[1][1];
    expect(channel).toBe('DISTRIBUTION');
    for (const [key, value] of Object.entries(candidateFormValues)) {
      if (key === 'vehicle.trim') continue;
      const field = fields.find((field) => field.key === key)!;
      expect(readAnswer(quoteData, field.answerPath), key).toEqual(
        field.type === 'boolean'
          ? value === 'true'
          : ['number', 'currency'].includes(field.type)
            ? Number(value)
            : value,
      );
    }
    expect(quoteData['residence.state']).toBe('NY');
    expect(quoteData.proposer.address.state).toBe('CA');
    expect(quoteData.residence).toBeUndefined();
    expect(quoteData['driver.namedOnAgreement']).toBe(true);
    expect(quoteData.driver.namedOnRentalAgreement).toBe(true);
    expect(quoteData['rentalAgreement.reference']).toBe('DEMO-RENTAL-001');
    expect(quoteData.rentalAgreement).toBeUndefined();
    expect(quoteData.additionalDrivers ?? []).toEqual([]);
    expect(quoteData.rental.coverages).toEqual(
      intake.coverageOptions.map(({ coverage }) => ({ coverage })),
    );
    expect(screen.queryByRole('button', { name: 'Review and continue' })).toBeNull();
  });
  it('retains all four additional-driver source fields, exact six-day dates and separate declarations for Direct', async () => {
    const view = await mount('DIRECT');
    fireEvent.click(screen.getByRole('button', { name: 'Add driver' }));
    const row = within(screen.getByRole('group', { name: 'Driver 1' }));
    fireEvent.change(row.getByLabelText('Driver full name'), {
      target: { value: 'Jordan Example' },
    });
    fireEvent.change(row.getByLabelText('Named on the rental agreement'), {
      target: { value: 'true' },
    });
    fireEvent.change(row.getByLabelText('Additional driver first name'), {
      target: { value: 'Jordan' },
    });
    fireEvent.change(row.getByLabelText('Additional driver last name'), {
      target: { value: 'Example' },
    });
    fireEvent.change(view.control('policy.endDate'), { target: { value: '24/09/2026' } });
    expect(view.control('policy.endAt').value).toBe('2026-09-24T10:00:00-06:00');
    fireEvent.submit(screen.getByRole('button', { name: 'Get my quote' }).closest('form')!);
    await screen.findByText('Quote retained in Facio');
    const { quoteData } = request.mock.calls[1][1];
    expect(quoteData.policy.endDate).toBe('2026-09-24');
    expect(quoteData.policy.endAt).toBe('2026-09-24T10:00:00-06:00');
    expect(quoteData.additionalDrivers).toEqual([
      {
        fullName: 'Jordan Example',
        namedOnAgreement: true,
        additionalFirstName: 'Jordan',
        additionalLastName: 'Example',
      },
    ]);
    expect(screen.getByRole('button', { name: 'Review and continue' })).toBeDefined();
    await waitFor(() =>
      expect(request.mock.calls.filter(([, body]) => body?.action === 'complete')).toHaveLength(0),
    );
  });
});
