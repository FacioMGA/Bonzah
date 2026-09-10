import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(async () => ({ id: 'run-1' })),
  updateMany: vi.fn(async () => ({ count: 1 })),
}));

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: {
    communicationTemplate: { findFirst: prismaMocks.findFirst },
    syntheticEmailRun: { create: prismaMocks.create, updateMany: prismaMocks.updateMany },
  },
}));

import { renderCustomerTemplate } from '../customerTemplateCatalogService.js';
import {
  recordSyntheticEmailRun,
  resolveDeployedSha,
  finaliseSyntheticEmailDelivery,
  markSyntheticEmailCleanup,
} from '../syntheticEmailAudit.js';

const VARS = {
  customer: { firstName: 'Ada' },
  quote: { url: 'https://app.example.test/quote/abc' },
};

describe('template approval gate (Phase 3)', () => {
  beforeEach(() => {
    prismaMocks.findFirst.mockReset();
    prismaMocks.create.mockClear();
  });

  it('applies an APPROVED DB override', async () => {
    prismaMocks.findFirst.mockResolvedValue({
      id: 'tpl-1',
      name: 'QUOTE_CHASER',
      subjectTemplate: 'DB OVERRIDE SUBJECT',
      approvalStatus: 'APPROVED',
      version: 3,
    });
    const out = await renderCustomerTemplate('QUOTE_CHASER', VARS);
    expect(out.subject).toBe('DB OVERRIDE SUBJECT');
    // The rendered revision is carried through so the synthetic audit can record
    // exactly which template version produced a canary email.
    expect(out.templateVersion).toBe(3);
  });

  it('refuses an unapproved (DRAFT) DB override and falls back to the shipped design', async () => {
    prismaMocks.findFirst.mockResolvedValue({
      id: 'tpl-1',
      name: 'QUOTE_CHASER',
      subjectTemplate: 'STALE DRAFT SUBJECT',
      approvalStatus: 'DRAFT',
      version: 9,
    });
    const out = await renderCustomerTemplate('QUOTE_CHASER', VARS);
    expect(out.subject).toBe('Reminder: your insurance quote is waiting');
    expect(out.subject).not.toContain('STALE DRAFT');
  });

  it('uses the code design when there is no DB row', async () => {
    prismaMocks.findFirst.mockResolvedValue(null);
    const out = await renderCustomerTemplate('QUOTE_CHASER', VARS);
    expect(out.subject).toBe('Reminder: your insurance quote is waiting');
    expect(out.templateVersion).toBeNull();
  });
});

describe('resolveDeployedSha', () => {
  it('prefers SENTRY_RELEASE, then falls back, then unknown', () => {
    const withRelease: NodeJS.ProcessEnv = { SENTRY_RELEASE: 'sha-a' };
    const withFallback: NodeJS.ProcessEnv = { RELEASE_SHA: 'sha-b' };
    const empty: NodeJS.ProcessEnv = {};
    expect(resolveDeployedSha(withRelease)).toBe('sha-a');
    expect(resolveDeployedSha(withFallback)).toBe('sha-b');
    expect(resolveDeployedSha(empty)).toBe('unknown');
  });
});

describe('recordSyntheticEmailRun', () => {
  beforeEach(() => prismaMocks.create.mockReset());

  it('writes an audit row with the resolved deploy SHA', async () => {
    process.env.SENTRY_RELEASE = 'sha-test';
    prismaMocks.create.mockResolvedValue({ id: 'run-1' });
    await recordSyntheticEmailRun({
      trigger: 'NEW_BUSINESS_PLACED',
      templateKey: 'NEW_BUSINESS_CONFIRMATION',
      recipients: ['qa@facio.io'],
      deliveryIds: ['msg-1'],
      source: 'ISSUANCE_PROOF',
    });
    expect(prismaMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deployedSha: 'sha-test',
          trigger: 'NEW_BUSINESS_PLACED',
          recipients: ['qa@facio.io'],
          deliveryIds: ['msg-1'],
          result: 'QUEUED',
          source: 'ISSUANCE_PROOF',
        }),
      }),
    );
  });

  it('persists messageId, tenant, templateVersion and cleanup status', async () => {
    prismaMocks.create.mockResolvedValue({ id: 'run-2' });
    await recordSyntheticEmailRun({
      trigger: 'NEW_BUSINESS_PLACED',
      templateKey: 'NEW_BUSINESS_CONFIRMATION',
      templateVersion: 4,
      messageId: 'msg-42',
      operatingTenantId: 'abbeygate-cy',
      recipients: ['qa@facio.io'],
      cleanupStatus: 'PENDING',
      source: 'ISSUANCE_PROOF',
      correlationId: 'policy-42',
    });
    expect(prismaMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          templateVersion: 4,
          messageId: 'msg-42',
          operatingTenantId: 'abbeygate-cy',
          cleanupStatus: 'PENDING',
          correlationId: 'policy-42',
        }),
      }),
    );
  });
});

describe('finaliseSyntheticEmailDelivery', () => {
  beforeEach(() => prismaMocks.updateMany.mockClear());

  it('updates the run keyed by messageId with the delivery outcome', async () => {
    await finaliseSyntheticEmailDelivery({
      messageId: 'msg-42',
      result: 'SENT',
      deliveryIds: ['provider-abc'],
    });
    expect(prismaMocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { messageId: 'msg-42' },
        data: expect.objectContaining({ result: 'SENT', deliveryIds: ['provider-abc'] }),
      }),
    );
  });

  it('is a no-op when messageId is empty', async () => {
    await finaliseSyntheticEmailDelivery({ messageId: '', result: 'SENT' });
    expect(prismaMocks.updateMany).not.toHaveBeenCalled();
  });
});

describe('markSyntheticEmailCleanup', () => {
  beforeEach(() => prismaMocks.updateMany.mockClear());

  it('closes out pending cleanup for the correlation', async () => {
    await markSyntheticEmailCleanup({ correlationId: 'policy-42', status: 'DONE' });
    expect(prismaMocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { correlationId: 'policy-42', cleanupStatus: 'PENDING' },
        data: expect.objectContaining({ cleanupStatus: 'DONE' }),
      }),
    );
  });
});
