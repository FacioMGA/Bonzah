import {
  openSecureDocument,
  openSecureDocumentPopup,
  toSecureDocumentEndpoint,
} from '@/src/modules/policies/documents/openSecureDocument';

/**
 * Open a policy document from the authenticated customer portal.
 * Uses the same binary fetch path as BO (ADR-0075) — never query-string tokens.
 */
export async function openClientDocument(
  href: string | null | undefined,
  opts?: { inline?: boolean },
): Promise<void> {
  const raw = String(href || '').trim();
  if (!raw) return;
  const inline = opts?.inline !== false;
  // Only authenticated API documents require a synchronous retained popup.
  // External/public links are delegated to the canonical helper, which opens
  // the destination once rather than leaving an orphan about:blank tab.
  if (!toSecureDocumentEndpoint(raw, { inline })) {
    await openSecureDocument(raw, { inline });
    return;
  }
  if (!inline) {
    await openSecureDocument(raw, { inline: false });
    return;
  }
  const popup = openSecureDocumentPopup();
  await openSecureDocument(raw, { inline, popup });
}
