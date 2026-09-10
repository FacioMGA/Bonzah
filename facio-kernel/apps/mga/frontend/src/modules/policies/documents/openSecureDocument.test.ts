/* @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from 'vitest';

const { requestBinary } = vi.hoisted(() => ({
  requestBinary: vi.fn(),
}));

vi.mock('@/src/shared/api/http', () => ({ http: { requestBinary } }));
vi.mock('@/src/shared/lib/logger', () => ({ logger: { error: vi.fn() } }));

import {
  openSecureDocument,
  openSecureDocumentPopup,
  toSecureDocumentEndpoint,
} from './openSecureDocument';

describe('toSecureDocumentEndpoint (ABY-452)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    requestBinary.mockReset();
  });

  it('maps an authenticated local document path to the http client endpoint', () => {
    expect(toSecureDocumentEndpoint('/api/documents/schedule-abc.pdf', { inline: true }))
      .toBe('documents/schedule-abc.pdf?inline=1');
  });

  it('strips a leaked token query from the local document route', () => {
    expect(toSecureDocumentEndpoint('/api/documents/schedule-abc.pdf?token=secret'))
      .toBe('documents/schedule-abc.pdf');
  });

  it('returns null for an external URL so callers open it as-is', () => {
    expect(toSecureDocumentEndpoint('https://blob.example.com/pack.pdf')).toBeNull();
  });

  it('never replaces the BO page when an inline popup is unavailable', async () => {
    requestBinary.mockResolvedValue(new Response(new Blob(['document'])));
    vi.spyOn(window, 'open').mockReturnValue(null);
    const assign = vi.spyOn(window.location, 'assign');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:secure-document');

    await openSecureDocument('/api/documents/schedule-abc.pdf', { inline: true, popup: null });

    expect(assign).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('retains a navigable popup while severing access to its opener', () => {
    const popup = Object.create(window) as Window;
    popup.opener = window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);

    expect(openSecureDocumentPopup()).toBe(popup);
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(popup.opener).toBeNull();
  });

  it('navigates the retained popup to the authenticated document blob', async () => {
    requestBinary.mockResolvedValue(new Response(new Blob(['document'])));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:secure-document');
    const popup = Object.create(window) as Window;
    Object.defineProperty(popup, 'location', { value: { href: 'about:blank' } });
    vi.spyOn(popup, 'close').mockImplementation(() => undefined);

    await openSecureDocument('/api/documents/schedule-abc.pdf', { inline: true, popup });

    expect(popup.location.href).toBe('blob:secure-document');
    expect(popup.close).not.toHaveBeenCalled();
  });

  it('downloads an authenticated document without opening a blank popup', async () => {
    requestBinary.mockResolvedValue(new Response(new Blob(['document'])));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:secure-document');
    const open = vi.spyOn(window, 'open');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await openSecureDocument('/api/documents/schedule-abc.pdf', { inline: false });

    expect(open).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
  });
});
