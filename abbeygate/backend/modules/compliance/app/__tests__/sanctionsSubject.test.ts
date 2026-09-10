import { describe, it, expect } from 'vitest';
import { resolveIndividualScreeningSubject } from '../sanctionsSubject.js';

describe('resolveIndividualScreeningSubject', () => {
  it('resolves name + DOB from the proposer (Motor/Home/Health shape)', () => {
    const subject = resolveIndividualScreeningSubject({
      quoteData: { proposer: { firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1985-05-05' } },
    });
    expect(subject).toEqual({ subjectName: 'Jane Doe', dateOfBirth: '1985-05-05' });
  });

  it('uses the canonical proposer when obsolete flat quote identity disagrees (ABY-403)', () => {
    const subject = resolveIndividualScreeningSubject({
      policyHolderName: 'Mark Sayers',
      quoteData: {
        firstName: 'Mark Douglas',
        lastName: 'Sawyers',
        dateOfBirth: '1960-01-01',
        proposer: { firstName: 'Mark', lastName: 'Sayers', dateOfBirth: '1985-04-20' },
      },
    });
    expect(subject).toEqual({ subjectName: 'Mark Sayers', dateOfBirth: '1985-04-20' });
  });

  it('uses the saved policyholder before obsolete flat quote identity', () => {
    const subject = resolveIndividualScreeningSubject({
      policyHolderName: 'Saved Policyholder',
      quoteData: {
        firstName: 'Stale',
        lastName: 'Draft',
        dateOfBirth: '1960-01-01',
      },
    });
    expect(subject).toEqual({ subjectName: 'Saved Policyholder' });
  });

  it('skips a placeholder saved name and screens a real legacy flat identity', () => {
    const subject = resolveIndividualScreeningSubject({
      policyHolderName: 'Quote in progress',
      quoteData: {
        firstName: 'Legacy',
        lastName: 'Customer',
        dateOfBirth: '1990-01-01',
      },
    });
    expect(subject).toEqual({ subjectName: 'Legacy Customer', dateOfBirth: '1990-01-01' });
  });

  it('resolves DOB from a top-level flat shape', () => {
    const subject = resolveIndividualScreeningSubject({
      quoteData: { firstName: 'John', lastName: 'Smith', dateOfBirth: '1990-01-01' },
    });
    expect(subject).toEqual({ subjectName: 'John Smith', dateOfBirth: '1990-01-01' });
  });

  it('resolves the Travel lead-traveller DOB when the proposer carries no DOB', () => {
    // Travel: policyholder IS the lead traveller and the wizard does not
    // collect proposer.dateOfBirth — the DOB lives on travellers.leadTravellerDOB.
    const subject = resolveIndividualScreeningSubject({
      quoteData: {
        proposer: { firstName: 'Ada', lastName: 'Travel' },
        travellers: { coverType: 'single', leadTravellerDOB: '1987-01-18' },
      },
    });
    expect(subject).toEqual({ subjectName: 'Ada Travel', dateOfBirth: '1987-01-18' });
  });

  it('skips a blank proposer DOB and still uses the lead-traveller DOB', () => {
    // A BO policyholder edit can leave proposer.dateOfBirth as ''. `??` would
    // stop there and drop the DOB — the resolver must fall through to the
    // required Travel leadTravellerDOB instead of screening name-only.
    const subject = resolveIndividualScreeningSubject({
      quoteData: {
        proposer: { firstName: 'Ada', lastName: 'Travel', dateOfBirth: '' },
        travellers: { leadTravellerDOB: '1987-01-18' },
      },
    });
    expect(subject).toEqual({ subjectName: 'Ada Travel', dateOfBirth: '1987-01-18' });
  });

  it('prefers an explicit proposer DOB over the lead-traveller DOB', () => {
    const subject = resolveIndividualScreeningSubject({
      quoteData: {
        proposer: { firstName: 'Ada', lastName: 'Travel', dateOfBirth: '1970-02-02' },
        travellers: { leadTravellerDOB: '1987-01-18' },
      },
    });
    expect(subject?.dateOfBirth).toBe('1970-02-02');
  });

  it('falls back to the policyHolderName when the quote has no proposer name', () => {
    const subject = resolveIndividualScreeningSubject({
      policyHolderName: 'Fallback User',
      quoteData: { travellers: { leadTravellerDOB: '1987-01-18' } },
    });
    expect(subject).toEqual({ subjectName: 'Fallback User', dateOfBirth: '1987-01-18' });
  });

  it('returns name-only (no dateOfBirth) when the DOB is empty or malformed', () => {
    const subject = resolveIndividualScreeningSubject({
      quoteData: {
        proposer: { firstName: 'No', lastName: 'Dob' },
        travellers: { leadTravellerDOB: 'not-a-date' },
      },
    });
    expect(subject).toEqual({ subjectName: 'No Dob' });
    expect(subject).not.toHaveProperty('dateOfBirth');
  });

  it('returns null when no subject name can be resolved', () => {
    expect(resolveIndividualScreeningSubject({ quoteData: {} })).toBeNull();
  });

  it('never resolves a system placeholder identity (ADR-0067)', () => {
    // A placeholder must never be sent to Creditsafe: it is not a real
    // person. The bind/payment/issue gate then blocks with
    // SANCTION_SCREENING_SUBJECT_MISSING until a real name is saved.
    for (const placeholder of [
      'Quote in progress',
      'QUOTE IN PROGRESS',
      '  quote in progress  ',
      'New Submission',
      'Auto Quote (In Progress)',
      'auto quote (in progress)',
    ]) {
      expect(resolveIndividualScreeningSubject({ policyHolderName: placeholder, quoteData: {} })).toBeNull();
    }
  });

  it('resolves the real proposer even when the policyHolderName is still a placeholder', () => {
    const subject = resolveIndividualScreeningSubject({
      policyHolderName: 'Quote in progress',
      quoteData: { proposer: { firstName: 'Real', lastName: 'Person', dateOfBirth: '1980-03-03' } },
    });
    expect(subject).toEqual({ subjectName: 'Real Person', dateOfBirth: '1980-03-03' });
  });
});
