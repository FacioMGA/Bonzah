/* @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openSecureDocument, openSecureDocumentPopup, toSecureDocumentEndpoint } = vi.hoisted(() => ({
  openSecureDocument: vi.fn(async () => undefined),
  openSecureDocumentPopup: vi.fn(),
  toSecureDocumentEndpoint: vi.fn(),
}));

vi.mock('@/src/modules/policies/documents/openSecureDocument', () => ({
  openSecureDocument,
  openSecureDocumentPopup,
  toSecureDocumentEndpoint,
}));

describe('openClientDocument', () => {
  beforeEach(() => {
    openSecureDocument.mockReset();
    openSecureDocumentPopup.mockReset();
    toSecureDocumentEndpoint.mockReset();
    toSecureDocumentEndpoint.mockReturnValue('documents/schedule.pdf?inline=1');
  });

  it('opens inline via the secure document helper', async () => {
    const popup = Object.create(window) as Window;
    openSecureDocumentPopup.mockReturnValue(popup);
    const { openClientDocument } = await import('./openClientDocument');
    await openClientDocument('/api/documents/schedule.pdf');
    expect(openSecureDocumentPopup).toHaveBeenCalledTimes(1);
    expect(openSecureDocument).toHaveBeenCalledWith('/api/documents/schedule.pdf', {
      inline: true,
      popup,
    });
  });

  it('no-ops on empty href', async () => {
    const { openClientDocument } = await import('./openClientDocument');
    await openClientDocument('');
    expect(openSecureDocument).not.toHaveBeenCalled();
  });

  it('does not pre-open a blank popup for an external document link', async () => {
    toSecureDocumentEndpoint.mockReturnValue(null);
    const { openClientDocument } = await import('./openClientDocument');
    await openClientDocument('https://files.example.test/policy.pdf');

    expect(openSecureDocumentPopup).not.toHaveBeenCalled();
    expect(openSecureDocument).toHaveBeenCalledWith('https://files.example.test/policy.pdf', {
      inline: true,
    });
  });

  it('uses the download path without a retained popup', async () => {
    const { openClientDocument } = await import('./openClientDocument');
    await openClientDocument('/api/documents/schedule.pdf', { inline: false });

    expect(openSecureDocumentPopup).not.toHaveBeenCalled();
    expect(openSecureDocument).toHaveBeenCalledWith('/api/documents/schedule.pdf', {
      inline: false,
    });
  });
});
