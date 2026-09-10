/**
 * ingestEmails.target.test — explicit business-object targeting (ADR-0044).
 *
 * Pins the operator/demo override: when a `target` is supplied, the ingested
 * thread is linked by resolving the *target id* against canonical Postgres —
 * the email's own link hints are ignored, and an unknown id is never
 * force-linked (it falls through to whatever the resolver returns).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NormalizedOutlookMessage } from '../../domain/providers/outlookMessage.js';

const resolveMock = vi.hoisted(() => ({ resolveBusinessObject: vi.fn() }));
const commsMock = vi.hoisted(() => ({
  getOrCreateThread: vi.fn(),
  createMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
}));
const eventsMock = vi.hoisted(() => ({
  appendDomainEvent: vi.fn().mockResolvedValue(undefined),
  buildDomainEvent: vi.fn((e: unknown) => e),
}));

vi.mock('../../../org2vec/index.js', () => resolveMock);
vi.mock('../communicationsService.js', () => ({ CommunicationsService: commsMock }));
vi.mock('../../../../platform/events/domainEvents.js', () => eventsMock);
vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({ getTenantConfig: () => ({ id: 'tenant-cy' }) }));
vi.mock('../../../../platform/db/connection.js', () => ({ tenantScopedPrisma: {} }));
vi.mock('../../../../platform/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { ingestEmails } from '../ingestEmails.js';

const heroMessage: NormalizedOutlookMessage = {
  externalMessageId: 'CY-MTR-017-001',
  conversationId: 'CY-MTR-017',
  subject: 'FNOL CY-MTR-017',
  from: { name: 'Demetris Broker', email: 'd@brokerbros.example' },
  to: [{ name: 'Abbeygate Claims', email: 'claims@abbeygate.example' }],
  sentAt: '2026-01-03T14:20:00.000Z',
  bodyText: 'Three-vehicle collision. Policy ABMTR-100417, reg PCM-6604.',
  attachments: [],
  linkHints: { claimReference: 'CY-MTR-017', policyReference: 'ABMTR-100417' },
};

describe('ingestEmails — explicit target override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commsMock.getOrCreateThread.mockResolvedValue({ id: 'thread-1' });
  });

  it('resolves by the supplied claim id, not the email link hints', async () => {
    resolveMock.resolveBusinessObject.mockResolvedValue({
      scopeType: 'CLAIM',
      scopeId: 'claim-real-123',
      claimNumber: 'CLM-2026-0004',
      policyId: 'pol-1',
      matchedBy: 'claim_id',
    });

    const result = await ingestEmails({
      messages: [heroMessage],
      source: 'sample',
      target: { scopeType: 'CLAIM', scopeId: 'claim-real-123' },
    });

    // Resolution keyed on the target id — hints (CY-MTR-017) are bypassed.
    expect(resolveMock.resolveBusinessObject).toHaveBeenCalledWith({ claimId: 'claim-real-123' });
    expect(commsMock.getOrCreateThread).toHaveBeenCalledWith('CLAIM', 'claim-real-123');
    expect(result.threads[0]).toMatchObject({ scopeType: 'CLAIM', scopeId: 'claim-real-123', matchedBy: 'claim_id' });
  });

  it('does not force-link an unknown target — falls through to UNRESOLVED', async () => {
    resolveMock.resolveBusinessObject.mockResolvedValue({ scopeType: 'UNRESOLVED', reason: 'no_match:claimId=ghost' });

    const result = await ingestEmails({
      messages: [heroMessage],
      source: 'sample',
      target: { scopeType: 'CLAIM', scopeId: 'ghost' },
    });

    expect(commsMock.getOrCreateThread).toHaveBeenCalledWith('UNRESOLVED', 'CY-MTR-017');
    expect(result.threads[0]).toMatchObject({ scopeType: 'UNRESOLVED', scopeId: null });
  });

  it('uses email identifier resolution when no target is supplied', async () => {
    resolveMock.resolveBusinessObject.mockResolvedValue({
      scopeType: 'CLAIM',
      scopeId: 'claim-from-hint',
      claimNumber: 'CY-MTR-017',
      policyId: null,
      matchedBy: 'claim_number',
    });

    await ingestEmails({ messages: [heroMessage], source: 'sample' });

    const call = resolveMock.resolveBusinessObject.mock.calls[0][0];
    expect(call).toMatchObject({ claimReference: 'CY-MTR-017' });
  });
});
