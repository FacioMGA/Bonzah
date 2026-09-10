import { http } from '@/src/shared/api/http';
import { logger } from '@/src/shared/lib/logger';

export function toSecureDocumentEndpoint(
  rawUrl: string | null | undefined,
  opts?: { inline?: boolean },
): string | null {
  const raw = String(rawUrl || '').trim();
  if (!raw) return null;
  try {
    const parsed = raw.startsWith('http://') || raw.startsWith('https://')
      ? new URL(raw)
      : new URL(raw, window.location.origin);
    if (!parsed.pathname.startsWith('/api/documents/')) return null;
    parsed.searchParams.delete('token');
    if (opts?.inline) parsed.searchParams.set('inline', '1');
    return `${parsed.pathname.replace(/^\/api\//, '')}${parsed.search}`;
  } catch {
    return null;
  }
}

export async function openSecureDocument(
  rawHref: string | null,
  opts?: { inline?: boolean; popup?: Window | null },
): Promise<void> {
  const href = String(rawHref || '').trim();
  if (!href) return;
  const inline = Boolean(opts?.inline);
  const endpoint = toSecureDocumentEndpoint(href, { inline });
  if (!endpoint) {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }
  // A popup is only needed to preserve a user gesture for an inline PDF view.
  // Downloads use an anchor with the download attribute and must not leave an
  // empty about:blank window behind.
  const popup = inline
    ? (opts && 'popup' in opts ? opts.popup : openSecureDocumentPopup())
    : null;
  try {
    const response = await http.requestBinary(endpoint);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    if (inline && popup) {
      popup.location.href = objectUrl;
    } else if (inline) {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } else {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = endpoint.split('/').pop()?.split('?')[0] || 'document';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    }
  } catch (error) {
    try { if (popup) popup.close(); } catch { /* no-op */ }
    logger.error('Secure document open failed:', error);
  }
}

export function openSecureDocumentPopup(): Window | null {
  const popup = window.open('about:blank', '_blank');
  if (popup) popup.opener = null;
  return popup;
}
