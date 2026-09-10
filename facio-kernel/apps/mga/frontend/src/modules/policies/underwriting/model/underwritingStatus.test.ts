import { describe, expect, it } from 'vitest';
import { buildUnderwritingStatusLines } from './underwritingStatus';

describe('buildUnderwritingStatusLines', () => {
  it('renders follow-up waiting text', () => {
    const lines = buildUnderwritingStatusLines({
      state: 'FOLLOWUPS_OPEN',
      followUpsSentAtText: '26 Mar 2026 at 13:45',
    });
    expect(lines).toEqual([
      'Follow-up questions sent to customer on 26 Mar 2026 at 13:45.',
      'Waiting for customer response.',
    ]);
  });

  it('renders questionnaire sent text with UW started line', () => {
    const lines = buildUnderwritingStatusLines({
      state: 'QUESTIONNAIRE_SENT',
      questionnaireSentAtText: '26 Mar 2026 at 13:45',
      lastSavedBy: 'underwriter',
      lastSavedByName: 'Uriel Aharoni',
      uwStartedAtText: '27 Mar 2026 at 10:11',
    });
    expect(lines).toEqual([
      'Questionnaire sent to customer on 26 Mar 2026 at 13:45.',
      'Waiting for customer completion.',
      'Uriel Aharoni started entering underwriting information on 27 Mar 2026 at 10:11.',
    ]);
  });

  it('renders customer started text', () => {
    const lines = buildUnderwritingStatusLines({
      state: 'CUSTOMER_STARTED',
      customerStartedAtText: '25 Mar 2026 at 09:00',
    });
    expect(lines).toEqual([
      'Customer started the questionnaire on 25 Mar 2026 at 09:00.',
      'Not yet submitted.',
    ]);
  });

  it('renders underwriter started text', () => {
    const lines = buildUnderwritingStatusLines({
      state: 'UW_STARTED',
      lastSavedByName: 'Uriel Aharoni',
      uwStartedAtText: '25 Mar 2026 at 10:00',
    });
    expect(lines).toEqual([
      'Uriel Aharoni started entering underwriting information on 25 Mar 2026 at 10:00.',
      'Not yet complete.',
    ]);
  });

  it('renders not-started text', () => {
    const lines = buildUnderwritingStatusLines({
      state: 'NOT_STARTED',
    });
    expect(lines).toEqual(['Underwriting has not started yet.']);
  });
});
