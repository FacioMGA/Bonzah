import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  findMany: vi.fn(async () => [] as unknown[]),
  findFirst: vi.fn(async (): Promise<unknown> => null),
}));
const dispatchMock = vi.hoisted(() => vi.fn(async () => ({ messageId: 'msg-preview-1' })));

vi.mock('../../../../platform/db/connection.js', () => ({
  prisma: {
    communicationTemplate: { findMany: prismaMocks.findMany, findFirst: prismaMocks.findFirst },
  },
}));
vi.mock('../customerEmailTriggerService.js', () => ({
  dispatchCustomerEmailTrigger: dispatchMock,
}));

import {
  emailCoverageReport,
  listEmailPreviewInventory,
  previewEmail,
  sendPreviewTestEmail,
} from '../emailPreviewService.js';

describe('emailPreviewService (Phase 4)', () => {
  beforeEach(() => {
    prismaMocks.findMany.mockClear();
    prismaMocks.findMany.mockResolvedValue([]);
    prismaMocks.findFirst.mockClear();
    prismaMocks.findFirst.mockResolvedValue(null);
    dispatchMock.mockClear();
    dispatchMock.mockResolvedValue({ messageId: 'msg-preview-1' });
    process.env.SYNTHETIC_EMAIL_ALLOWLIST = 'qa+preview@facio.io';
  });

  it('lists inventory with governance defaults when no DB rows exist', async () => {
    const inv = await listEmailPreviewInventory();
    expect(inv.triggerTemplates.length).toBeGreaterThan(0);
    const item = inv.triggerTemplates.find((i) => i.templateKey === 'QUOTE_STANDARD');
    expect(item).toBeTruthy();
    expect(item?.governance.hasDbOverride).toBe(false);
  });

  it('lists Home variants and dispatches their product-aware synthetic test sends', async () => {
    const inv = await listEmailPreviewInventory();
    expect(inv.triggerTemplates).toEqual(expect.arrayContaining([
      expect.objectContaining({ templateKey: 'HOME_QUOTE_STANDARD', trigger: 'QUOTE_SENT', productCode: 'HOME' }),
      expect.objectContaining({ templateKey: 'HOME_RENEWAL_CONFIRMATION', trigger: 'NEW_BUSINESS_PLACED', productCode: 'HOME', isRenewal: true }),
    ]));

    const res = await sendPreviewTestEmail({ templateKey: 'HOME_RENEWAL_CONFIRMATION', toEmail: 'qa+preview@facio.io', jurisdiction: 'CY' });
    expect(res.sent).toBe(true);
    expect(dispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'NEW_BUSINESS_PLACED',
      productCode: 'HOME',
      isRenewal: true,
    }));
  });

  it('surfaces DB governance (version/approvalStatus) when a row exists', async () => {
    prismaMocks.findMany.mockResolvedValue([
      { name: 'QUOTE_STANDARD', version: 4, approvalStatus: 'APPROVED', approvedBy: 'a', approvedAt: new Date('2026-01-01'), lastEditor: 'a', lastDeployedSha: 'sha1' },
    ]);
    const inv = await listEmailPreviewInventory();
    const item = inv.triggerTemplates.find((i) => i.templateKey === 'QUOTE_STANDARD');
    expect(item?.governance.hasDbOverride).toBe(true);
    expect(item?.governance.version).toBe(4);
    expect(item?.governance.approvalStatus).toBe('APPROVED');
  });

  it('surfaces direct (non-registry) email producers so the estate view is honest', async () => {
    const inv = await listEmailPreviewInventory();
    expect(inv.directProducers.length).toBeGreaterThan(0);
    expect(inv.directProducers.some((p) => p.id === 'CARDOG_MODEL_SUGGESTION')).toBe(true);
  });

  it('renders the APPROVED DB override (not just the code fallback) in preview', async () => {
    prismaMocks.findFirst.mockResolvedValue({
      id: 'tpl-x', name: 'QUOTE_STANDARD', channel: 'EMAIL', enabled: true,
      subjectTemplate: 'DB OVERRIDE PREVIEW SUBJECT', approvalStatus: 'APPROVED', version: 7,
    });
    const out = await previewEmail({ trigger: 'QUOTE_SENT', jurisdiction: 'CY' });
    expect(out.subject).toContain('DB OVERRIDE PREVIEW SUBJECT');
  });

  it('renders a preview by trigger with the synthetic banner and no missing variables', async () => {
    const out = await previewEmail({ trigger: 'QUOTE_SENT', jurisdiction: 'PT' });
    expect(out.templateKey).toBe('QUOTE_STANDARD');
    expect(out.jurisdiction).toBe('PT');
    expect(out.subject.startsWith('[SYNTHETIC TEST')).toBe(true);
    expect(out.bodyHtml).toContain('SYNTHETIC TEST — NOT A REAL POLICY');
    expect(out.missingVariables).toEqual([]);
    expect(out.lint.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('produces a coverage report where every template renders clean', async () => {
    const report = await emailCoverageReport();
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.summary.withErrors).toBe(0);
    expect(report.summary.directProducers).toBeGreaterThan(0);
    expect(report.rows.every((r) => r.hasFixture)).toBe(true);
  });

  describe('sendPreviewTestEmail', () => {
    it('refuses a non-allowlisted recipient without dispatching', async () => {
      const res = await sendPreviewTestEmail({ trigger: 'QUOTE_SENT', toEmail: 'real@customer.com' });
      expect(res.sent).toBe(false);
      expect(res.blocked).toBe(true);
      expect(dispatchMock).not.toHaveBeenCalled();
    });

    it('dispatches a synthetic, system-only-forced send to an allowlisted mailbox', async () => {
      const res = await sendPreviewTestEmail({ trigger: 'QUOTE_SENT', toEmail: 'qa+preview@facio.io', jurisdiction: 'CY' });
      expect(res.sent).toBe(true);
      expect(res.messageId).toBe('msg-preview-1');
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'QUOTE_SENT',
          toEmail: 'qa+preview@facio.io',
          synthetic: true,
          source: 'PREVIEW_TEST_SEND',
          forceSystemOnly: true,
        }),
      );
    });

    it('refuses a cross-jurisdiction send (branding is pinned to the operating tenant)', async () => {
      // Test harness operates as the CY tenant; a PT send would be CY-branded.
      const res = await sendPreviewTestEmail({ trigger: 'QUOTE_SENT', toEmail: 'qa+preview@facio.io', jurisdiction: 'PT' });
      expect(res.sent).toBe(false);
      expect(res.blocked).toBe(true);
      expect(dispatchMock).not.toHaveBeenCalled();
    });
  });
});
