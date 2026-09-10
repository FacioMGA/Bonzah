import { describe, expect, it } from 'vitest';
import { resolveUwWorkflowState } from '../issueReadiness.js';

describe('resolveUwWorkflowState', () => {
  it('prioritizes open follow-ups over quote-ready', () => {
    const state = resolveUwWorkflowState({
      hasOpenFollowUps: true,
      isQuoteReady: true,
    });
    expect(state).toBe('FOLLOWUPS_OPEN');
  });

  it('returns quote-ready when ready and no open follow-ups', () => {
    const state = resolveUwWorkflowState({
      hasOpenFollowUps: false,
      isQuoteReady: true,
    });
    expect(state).toBe('QUOTE_READY');
  });

  it('returns questionnaire-sent before actor-started states', () => {
    const state = resolveUwWorkflowState({
      hasOpenFollowUps: false,
      isQuoteReady: false,
      questionnaireSentAt: '2026-03-20T10:00:00.000Z',
      customerStartedAt: '2026-03-19T10:00:00.000Z',
      uwStartedAt: '2026-03-18T10:00:00.000Z',
      lastSavedBy: 'underwriter',
    });
    expect(state).toBe('QUESTIONNAIRE_SENT');
  });

  it('returns customer-started when customer has started and questionnaire not sent', () => {
    const state = resolveUwWorkflowState({
      hasOpenFollowUps: false,
      isQuoteReady: false,
      customerStartedAt: '2026-03-20T10:00:00.000Z',
    });
    expect(state).toBe('CUSTOMER_STARTED');
  });

  it('returns not-started when only generic underwriter save marker exists', () => {
    const state = resolveUwWorkflowState({
      hasOpenFollowUps: false,
      isQuoteReady: false,
      lastSavedBy: 'underwriter',
    });
    expect(state).toBe('NOT_STARTED');
  });

  it('returns uw-started when explicit UW started timestamp exists', () => {
    const state = resolveUwWorkflowState({
      hasOpenFollowUps: false,
      isQuoteReady: false,
      uwStartedAt: '2026-03-20T10:00:00.000Z',
    });
    expect(state).toBe('UW_STARTED');
  });

  it('returns not-started when no signal exists', () => {
    const state = resolveUwWorkflowState({
      hasOpenFollowUps: false,
      isQuoteReady: false,
    });
    expect(state).toBe('NOT_STARTED');
  });
});
