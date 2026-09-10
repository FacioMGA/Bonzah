import { describe, expect, it } from 'vitest';
import { readDomainEventLike, resolvePolicyEntityId, type DomainEventLike } from '../loadManifest.js';

describe('DomainEventLike (ABBEYGATE-1Q)', () => {
  it('reads optional eventType from unknown job data without inventing one', () => {
    const event: DomainEventLike | null = readDomainEventLike({
      aggregateId: 'evt_1',
      data: { policyId: 'pol_carried' },
    });
    expect(event).toEqual({
      eventType: undefined,
      aggregateId: 'evt_1',
      aggregateType: undefined,
      to: undefined,
      data: { policyId: 'pol_carried' },
    });
  });

  it('returns the aggregate id for POLICY events', () => {
    const event: DomainEventLike = {
      eventType: 'POLICY.ISSUED',
      aggregateId: 'pol_1',
      aggregateType: 'POLICY',
    };
    expect(resolvePolicyEntityId(event)).toBe('pol_1');
  });

  it('resolves a carried policyId when eventType is absent', () => {
    const event: DomainEventLike = {
      aggregateId: 'evt_1',
      data: { policyId: 'pol_carried' },
    };
    expect(resolvePolicyEntityId(event)).toBe('pol_carried');
  });

  it('returns null when there is no policy id to resolve', () => {
    const event: DomainEventLike = {
      aggregateId: '',
      data: {},
    };
    expect(resolvePolicyEntityId(event)).toBeNull();
  });
});
