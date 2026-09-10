import { describe, expect, it } from 'vitest';
import {
  applyFeedToFilters,
  buildFeedStatusInValue,
  feedConflictsWithFilters,
  parsePolicyListFeed,
  QUOTATION_FEED_STATUSES,
  ISSUED_FEED_STATUSES,
} from '../policyListFeeds';

describe('policyListFeeds', () => {
  it('parses feed URL aliases', () => {
    expect(parsePolicyListFeed(null)).toBe('all');
    expect(parsePolicyListFeed('')).toBe('all');
    expect(parsePolicyListFeed('quotations')).toBe('quotations');
    expect(parsePolicyListFeed('quotes')).toBe('quotations');
    expect(parsePolicyListFeed('issued')).toBe('issued');
    expect(parsePolicyListFeed('issued_policies')).toBe('issued');
  });

  it('builds comma-separated status_in values for each feed', () => {
    expect(buildFeedStatusInValue('all')).toBe('');
    expect(buildFeedStatusInValue('quotations')).toBe(QUOTATION_FEED_STATUSES.join(','));
    expect(buildFeedStatusInValue('issued')).toBe(ISSUED_FEED_STATUSES.join(','));
  });

  it('applies feed presets to filters', () => {
    expect(applyFeedToFilters('all', { status: 'ACTIVE', status_in: 'DRAFT', needsAttention: 'yes' })).toEqual({
      status: 'ACTIVE',
      needsAttention: 'yes',
    });
    expect(applyFeedToFilters('quotations', { status: 'ACTIVE' })).toEqual({
      status_in: QUOTATION_FEED_STATUSES.join(','),
    });
    expect(applyFeedToFilters('issued', {})).toEqual({
      status_in: ISSUED_FEED_STATUSES.join(','),
    });
  });

  it('detects manual status overrides', () => {
    expect(feedConflictsWithFilters('quotations', { status_in: QUOTATION_FEED_STATUSES.join(',') })).toBe(false);
    expect(feedConflictsWithFilters('quotations', { status: 'QUOTED' })).toBe(true);
    expect(feedConflictsWithFilters('issued', { status_in: 'ACTIVE' })).toBe(true);
  });
});
