import { describe, expect, it } from 'vitest';
import {
  buildUnknownPolicyOverviewFields,
  formatCaseIntakeDraftLocation,
  shouldShowSendFnolButton,
  summarizeCaseInfoRequests,
} from '../ClaimSummaryTab';

describe('ClaimSummaryTab helpers', () => {
  it('formats unknown-policy locations with city context when available', () => {
    expect(formatCaseIntakeDraftLocation({
      location: '124 Conch Street, Limassol',
      locationDetails: {
        address: '124 Conch Street',
        city: 'Limassol',
      },
    })).toBe('124 Conch Street, Limassol');
  });

  it('builds overview fields for saved unknown-policy intake details', () => {
    const fields = buildUnknownPolicyOverviewFields({
      draft: {
        reporterType: 'LAWYER',
        contactName: 'Maria Nicolaou',
        contactPhone: '+35799111222',
        contactEmail: 'maria@example.com',
        shortDescription: 'Rear-end collision',
        dateOfLoss: '2026-04-07',
        location: '124 Conch Street, Limassol',
        locationDetails: {
          address: '124 Conch Street',
          city: 'Limassol',
        },
        insuredName: 'Andreas Nicolaou',
      },
      formatDate: (value) => value || '—',
    });

    expect(fields).toEqual(expect.arrayContaining([
      { label: 'Contact name', value: 'Maria Nicolaou' },
      { label: 'Location', value: '124 Conch Street, Limassol' },
      { label: 'Insured name', value: 'Andreas Nicolaou' },
    ]));
  });

  it('caps displayed case info requests to the latest three', () => {
    const requests = summarizeCaseInfoRequests([
      { id: '1', status: 'OPEN', message: 'A', requestedAt: '1' },
      { id: '2', status: 'OPEN', message: 'B', requestedAt: '2' },
      { id: '3', status: 'OPEN', message: 'C', requestedAt: '3' },
      { id: '4', status: 'OPEN', message: 'D', requestedAt: '4' },
    ]);

    expect(requests.map((request) => request.id)).toEqual(['1', '2', '3']);
  });

  it('keeps the FNOL send action visible through linked pre-FNOL states', () => {
    expect(shouldShowSendFnolButton({ intakeStage: 'EMPTY', awaitingCustomerResponse: false })).toBe(true);
    expect(shouldShowSendFnolButton({ intakeStage: 'INCOMPLETE', awaitingCustomerResponse: false })).toBe(true);
    expect(shouldShowSendFnolButton({ intakeStage: 'CLARIFICATION', awaitingCustomerResponse: false })).toBe(true);
    expect(shouldShowSendFnolButton({ intakeStage: 'READY', awaitingCustomerResponse: false })).toBe(false);
    expect(shouldShowSendFnolButton({ intakeStage: 'EMPTY', awaitingCustomerResponse: true })).toBe(false);
  });
});
