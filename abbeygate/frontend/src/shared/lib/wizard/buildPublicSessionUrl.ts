/**
 * Canonical builder for public quote-session URLs.
 *
 * Per docs/architecture/contracts/canonical-ownership.md:
 *   - The product code MUST drive the URL; never hardcode 'motor'/'home'/'travel'
 *     in shared code.
 *   - Every wizard public-session API call goes through this builder.
 *
 * Examples:
 *   buildPublicSessionUrl('motor', token)             -> /api/public/motor/session/<token>
 *   buildPublicSessionUrl('motor', token, 'rate')     -> /api/public/motor/session/<token>/rate
 *   buildPublicSessionUrl('home',  token, 'issue-readiness')
 *                                                     -> /api/public/home/session/<token>/issue-readiness
 *
 * The product code is lowercased. Empty `segment` returns the session root
 * URL with no trailing slash. The token is encodeURIComponent'd.
 */
export function buildPublicSessionUrl(productCode: string, token: string, segment?: string): string {
  const product = normalizeProduct(productCode);
  const encodedToken = encodeURIComponent(String(token || '').trim());
  const base = `/api/public/${product}/session/${encodedToken}`;
  if (!segment) return base;
  const cleanSegment = segment.startsWith('/') ? segment.slice(1) : segment;
  return `${base}/${cleanSegment}`;
}

/**
 * Returns the create-session collection URL for a product, e.g.
 *   /api/public/motor/session
 * Used by the public landing page that creates a fresh session.
 */
export function buildPublicSessionCreateUrl(productCode: string): string {
  return `/api/public/${normalizeProduct(productCode)}/session`;
}

function normalizeProduct(productCode: string): string {
  const product = String(productCode || '').trim().toLowerCase();
  if (!product) {
    throw new Error('buildPublicSessionUrl: productCode is required');
  }
  return product;
}
