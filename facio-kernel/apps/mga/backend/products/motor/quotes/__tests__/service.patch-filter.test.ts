import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../platform/events/queue.js', () => ({
  routeEventToQueue: vi.fn(),
}));
import {
  filterQuoteDataPatchByStep,
  preserveIssueDetailsNonClobberFields,
} from '../../../../modules/quotes/app/publicAutoQuoteService.js';

describe('filterQuoteDataPatchByStep', () => {
  it('keeps structured conviction severity data for driving-history saves', () => {
    const payload = {
      hasConvictions: true,
      motorConvictions: [
        {
          date: '2025-01-01',
          convictionClass: 'serious_technical',
          description: 'DR10 drink-driving conviction.',
        },
      ],
      convictionClass: 'serious_technical',
      convictionsDetails: '#1 — date: 2025-01-01 — type: Serious technical offence — details: DR10 drink-driving conviction.',
      hasMajorConvictionLast5Years: false,
      majorConvictionsCountLast5Years: 0,
      seriousTechnicalOffenceCount: 1,
      randomKey: 'drop-me',
    };

    const filtered = filterQuoteDataPatchByStep(payload, 'driving-history');

    expect(filtered.motorConvictions).toEqual(payload.motorConvictions);
    expect(filtered.convictionClass).toBe('serious_technical');
    expect(filtered.convictionsDetails).toBe(payload.convictionsDetails);
    expect(filtered.hasMajorConvictionLast5Years).toBe(false);
    expect(filtered.majorConvictionsCountLast5Years).toBe(0);
    expect(filtered.seriousTechnicalOffenceCount).toBe(1);
    expect(filtered.randomKey).toBeUndefined();
  });

  it('keeps cross-step fields (incl. proposer) for issue-details remediation', () => {
    const payload = {
      proposer: { firstName: 'Ari', lastName: 'Lovelace' },
      licenseYears: '8',
      registrationNumber: 'ABC123',
      additionalDrivers: [{ firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1990-01-01' }],
      __meta: { origin: 'customer' },
      randomKey: 'drop-me',
    };

    const filtered = filterQuoteDataPatchByStep(payload, 'issue-details');

    expect(filtered.proposer).toEqual({ firstName: 'Ari', lastName: 'Lovelace' });
    expect(filtered.licenseYears).toBe('8');
    expect(filtered.registrationNumber).toBe('ABC123');
    expect(filtered.additionalDrivers).toEqual([{ firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1990-01-01' }]);
    expect(filtered.__meta).toEqual({ origin: 'customer' });
    expect(filtered.randomKey).toBeUndefined();
  });

  it('filters unknown keys for scoped policy-holder step', () => {
    const payload = {
      proposer: { firstName: 'Ari' },
      make: 'BMW',
      __meta: { origin: 'customer' },
      randomKey: 'drop-me',
    };

    const filtered = filterQuoteDataPatchByStep(payload, 'policy-holder');

    expect(filtered.proposer).toEqual({ firstName: 'Ari' });
    expect(filtered.make).toBeUndefined();
    expect(filtered.__meta).toEqual({ origin: 'customer' });
    expect(filtered.randomKey).toBeUndefined();
  });

  it('passes through payload for unknown step keys', () => {
    const payload = { proposer: { firstName: 'Ari' }, randomKey: 'keep-me' };
    const filtered = filterQuoteDataPatchByStep(payload, 'unknown-step');
    expect(filtered).toEqual(payload);
  });

  it('preserves existing non-empty issue-details proposer values when incoming payload is blank', () => {
    const incoming = {
      proposer: {
        firstName: '',
        occupation: '',
        whereDidYouHear: '',
      },
      licenseYears: '',
      licenseType: '',
    };
    const prev = {
      proposer: {
        firstName: 'Ari',
        occupation: 'Engineer',
        whereDidYouHear: 'Google',
      },
      licenseYears: '8',
      licenseType: 'Full',
    };

    const preserved = preserveIssueDetailsNonClobberFields(incoming, prev);
    const preservedProposer = (preserved.proposer ?? {}) as Record<string, unknown>;
    expect(preservedProposer.firstName).toBeUndefined();
    expect(preservedProposer.occupation).toBeUndefined();
    expect(preservedProposer.whereDidYouHear).toBeUndefined();
    expect(preserved.licenseYears).toBeUndefined();
    expect(preserved.licenseType).toBeUndefined();
  });

  it('preserves an existing vehicle registration / VIN when the issue-details patch is blank (ABY-346)', () => {
    const incoming = { registrationNumber: '', vin: '' };
    const prev = { registrationNumber: 'KAB1234', vin: 'WAUZZZ8V0LA123456' };

    const preserved = preserveIssueDetailsNonClobberFields(incoming, prev);

    // The blank incoming values are dropped so the merge keeps the prior values.
    expect(preserved.registrationNumber).toBeUndefined();
    expect(preserved.vin).toBeUndefined();
  });

  it('still accepts a non-blank incoming registration / VIN (ABY-346)', () => {
    const incoming = { registrationNumber: 'KAB9999', vin: 'NEWVIN0000000000' };
    const prev = { registrationNumber: 'KAB1234', vin: 'WAUZZZ8V0LA123456' };

    const preserved = preserveIssueDetailsNonClobberFields(incoming, prev);

    expect(preserved.registrationNumber).toBe('KAB9999');
    expect(preserved.vin).toBe('NEWVIN0000000000');
  });

  it('preserves vehicle value fields when the issue-details patch is blank (ABY-338)', () => {
    const incoming = { vehicleValue: '', garageTotalValue: '' };
    const prev = { vehicleValue: 32500, garageTotalValue: 82500 };

    const preserved = preserveIssueDetailsNonClobberFields(incoming, prev);

    expect(preserved.vehicleValue).toBeUndefined();
    expect(preserved.garageTotalValue).toBeUndefined();
  });

  it('still accepts explicit vehicle value replacements from issue-details (ABY-338)', () => {
    const incoming = { vehicleValue: 33500, garageTotalValue: 90000 };
    const prev = { vehicleValue: 32500, garageTotalValue: 82500 };

    const preserved = preserveIssueDetailsNonClobberFields(incoming, prev);

    expect(preserved.vehicleValue).toBe(33500);
    expect(preserved.garageTotalValue).toBe(90000);
  });
});
