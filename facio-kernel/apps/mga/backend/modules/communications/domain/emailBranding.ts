/**
 * Email branding — single source of truth for customer email visual identity.
 *
 * Centralises:
 *   • Brand name + logo URL (sourced from per-tenant config; never hardcoded
 *     inside individual email templates)
 *   • Brand color tokens used by the shared HTML wrapper
 *   • Per-jurisdiction regulatory signature blocks (Cyprus, Portugal, Spain,
 *     Greece) — the legal text every customer email must carry
 *   • A pure HTML layout renderer that wraps body content in a modern,
 *     accessible, mobile-friendly email shell
 *
 * Layer rules:
 *   • This file lives in the communications domain. It is pure: no Prisma,
 *     no Express, no `getTenantConfig()`. The app layer resolves the tenant
 *     and injects a {@link BrandProfile} into the renderer.
 *   • Email templates must NEVER contain `{{brandName}}` / logo placeholders
 *     in their static HTML. The wrapper here owns brand chrome end-to-end.
 */
import { renderTemplate } from './templateRenderer.js';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type BrandJurisdictionKey = string;

export interface BrandPhoneEntry {
  /** Display label, e.g. "WhatsApp / Viber — New Business". */
  label: string;
  /** Human-readable number, e.g. "+357 97 612602". */
  display: string;
  /** Compact digits-only number for `tel:` links, e.g. "+35797612602". */
  tel: string;
  /** Optional WhatsApp click-to-chat number (digits only, no `+`). */
  whatsapp?: string;
}

export interface BrandSignature {
  /** Country / jurisdiction display name, e.g. "Cyprus". */
  jurisdiction: string;
  /** Multi-line legal lead-in (the "trading name … registered in …" block). */
  legalLines: string[];
  /** Address lines (multi-line). */
  addressLines: string[];
  /** Optional regulator line (e.g. ICCS). */
  regulatorLine?: string;
  /** Optional public website (display label) — e.g. "Your company website". */
  websiteLabel?: string;
  /** Optional public website URL (https://…). */
  websiteUrl?: string;
  /** Phones, in display order. */
  phones: BrandPhoneEntry[];
  /** Optional working-hours line. */
  hours?: string;
}

export interface BrandColors {
  /** Header background, primary brand color (e.g. navy). */
  primary: string;
  /** Text color on `primary`. */
  onPrimary: string;
  /** Accent / link color used throughout the email body. */
  accent: string;
  /** Outermost page background. */
  pageBg: string;
  /** Card / content background. */
  cardBg: string;
  /** Subtle muted background (signature panel, footer). */
  mutedBg: string;
  /** Body text. */
  text: string;
  /** Secondary / muted text. */
  textMuted: string;
  /** Hairline divider color. */
  divider: string;
}

export interface BrandProfile {
  brandName: string;
  jurisdictionKey: BrandJurisdictionKey;
  /** Public PNG URL of the logo to render on the dark header band. */
  logoUrl: string;
  logoAlt: string;
  /** Text used as preview / preheader in the inbox preview. */
  defaultPreheader: string;
  publicBaseUrl: string;
  fromEmail: string;
  colors: BrandColors;
  signature: BrandSignature;
}

const DEFAULT_COLORS: BrandColors = {
  primary: '#0b3b6f',
  onPrimary: '#ffffff',
  accent: '#0b3b6f',
  pageBg: '#f5f7fb',
  cardBg: '#ffffff',
  mutedBg: '#f8fafc',
  text: '#0f172a',
  textMuted: '#64748b',
  divider: '#e5e9f2',
};

export interface BuildBrandProfileInput {
  countryCode: string;
  brokerName?: string | null;
  whiteLogoUrl?: string | null;
  publicBaseUrl: string;
  fromEmail: string;
  colors?: Partial<BrandColors>;
  signature?: BrandSignature;
}

/** Pure projection of explicitly supplied tenant content. No jurisdiction-specific customer fallback. */
export function buildBrandProfile(input: BuildBrandProfileInput): BrandProfile {
  const brandName = input.brokerName?.trim();
  const baseUrl = stripTrailingSlash(input.publicBaseUrl);
  if (!brandName || !/^https?:\/\//.test(baseUrl) || !input.fromEmail || !input.signature)
    throw new Error('TENANT_CONFIGURATION_INCOMPLETE: explicit email branding and legal signature are required');
  const signature = input.signature;
  const colors = { ...DEFAULT_COLORS, ...(input.colors || {}) };
  return {
    brandName,
    jurisdictionKey: input.countryCode,
    logoUrl: input.whiteLogoUrl?.trim() || '',
    logoAlt: `${brandName} ${signature.jurisdiction}`,
    defaultPreheader: `A message from ${brandName} ${signature.jurisdiction}.`,
    publicBaseUrl: baseUrl,
    fromEmail: input.fromEmail,
    colors,
    signature,
  };
}

/** Compatibility entrypoint; callers must inject the resolved tenant profile. */
export function getFallbackBrandProfile(): BrandProfile {
  throw new Error('TENANT_CONFIGURATION_INCOMPLETE: email rendering requires an explicit tenant brand');
}

function stripTrailingSlash(value: string): string {
  return String(value || '').replace(/\/+$/, '');
}

// ────────────────────────────────────────────────────────────────────────────
// HTML helpers
// ────────────────────────────────────────────────────────────────────────────

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

/**
 * Escape HTML in plain-text content while preserving and auto-linking URLs
 * and converting newlines to `<br/>`. Designed for the body that templates
 * emit (e.g. `Hi {{customer.firstName}},\nClick {{quote.url}}`).
 */
function renderPlainTextAsHtml(
  content: string,
  accent: string,
  inlineLinks: ReadonlyArray<{ label: string; url: string }> = [],
): string {
  const source = String(content);
  const matches: Array<{ start: number; end: number; label: string; url: string; priority: number }> = [];

  for (const link of inlineLinks) {
    const label = String(link.label || '');
    const url = String(link.url || '').trim();
    if (!label || !/^https?:\/\//i.test(url)) continue;
    let start = source.indexOf(label);
    while (start >= 0) {
      matches.push({ start, end: start + label.length, label, url, priority: 0 });
      start = source.indexOf(label, start + label.length);
    }
  }

  for (const match of source.matchAll(URL_PATTERN)) {
    const url = match[0];
    const start = match.index ?? 0;
    matches.push({ start, end: start + url.length, label: url, url, priority: 1 });
  }

  matches.sort((a, b) => a.start - b.start || a.priority - b.priority || b.end - a.end);
  const segments: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) segments.push(escapeHtml(source.slice(cursor, match.start)));
    segments.push(
      `<a href="${escapeAttr(match.url)}" style="color:${accent};text-decoration:underline;word-break:break-all;">${escapeHtml(match.label)}</a>`,
    );
    cursor = match.end;
  }
  if (cursor < source.length) segments.push(escapeHtml(source.slice(cursor)));
  return segments.join('').replace(/\n/g, '<br/>');
}

// ────────────────────────────────────────────────────────────────────────────
// Layout renderer (HTML email shell)
// ────────────────────────────────────────────────────────────────────────────

export interface RenderEmailLayoutOptions {
  /** The pre-rendered template body (plain text with newlines). */
  bodyText: string;
  /** Brand profile to apply (logo, color, signature). */
  brand: BrandProfile;
  /** Optional preview text shown in the inbox snippet (overrides default). */
  preheader?: string;
  /** Optional <title> for the email document (defaults to brand name). */
  title?: string;
  /** Explicit safe anchors for labels such as a quote or policy reference. */
  inlineLinks?: ReadonlyArray<{ label: string; url: string }>;
  /**
   * When true this email is a SYNTHETIC test/canary message, not a real
   * customer communication. A prominent, unmissable banner is rendered at the
   * very top of the body so no recipient can mistake a health-check or preview
   * for a genuine policy. Pair with {@link SYNTHETIC_TEST_SUBJECT_PREFIX} on the
   * subject (the renderer applies both together).
   */
  synthetic?: boolean;
}

/**
 * Subject-line marker for synthetic (test / canary / preview) emails. Kept as a
 * single exported constant so the renderer, the Email Preview & Testing Centre
 * and any test-send path all stamp the exact same text and tests can assert it.
 */
export const SYNTHETIC_TEST_SUBJECT_PREFIX = '[SYNTHETIC TEST — NOT A REAL POLICY] ';

/**
 * Full-width warning banner injected at the top of a synthetic email body. Uses
 * inline styles only (email clients strip <style>) and a table row so it renders
 * consistently across Outlook/Gmail/Apple Mail.
 */
function renderSyntheticBanner(): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#b00020;">
  <tr>
    <td align="center" style="padding:14px 16px;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.4;letter-spacing:0.02em;">
      ⚠️ SYNTHETIC TEST — NOT A REAL POLICY. This message was generated by an automated system check or preview. No cover exists, no payment is due, and no action is required.
    </td>
  </tr>
</table>`;
}

/**
 * Render a complete, table-based, mobile-friendly HTML email around the
 * given body content. The result is safe to drop directly into SendGrid /
 * SMTP `html` payloads — no further substitution required.
 */
export function renderEmailLayout(options: RenderEmailLayoutOptions): string {
  const { bodyText, brand } = options;
  const { colors } = brand;
  const preheader = options.preheader || brand.defaultPreheader;
  const safePreheader = escapeHtml(preheader);
  const safeBrandName = escapeHtml(brand.brandName);
  const safeJurisdiction = escapeHtml(brand.signature.jurisdiction);
  const safeLogoUrl = escapeAttr(brand.logoUrl);
  const safeLogoAlt = escapeAttr(brand.logoAlt);
  const safeTitle = escapeHtml(options.title || brand.brandName);
  const bodyHtml = renderPlainTextAsHtml(bodyText, colors.accent, options.inlineLinks);
  const signatureHtml = renderSignatureBlock(brand);
  const year = new Date().getUTCFullYear();
  const syntheticBanner = options.synthetic ? renderSyntheticBanner() : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:${colors.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${colors.pageBg};opacity:0;">${safePreheader}</div>
${syntheticBanner}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${colors.pageBg};">
  <tr>
    <td align="center" style="padding:32px 16px 40px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:640px;width:100%;background:${colors.cardBg};border:1px solid ${colors.divider};border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:${colors.primary};padding:28px 32px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
              <tr>
                <td align="left" style="vertical-align:middle;">
                  <img src="${safeLogoUrl}" alt="${safeLogoAlt}" height="36" style="display:block;height:36px;width:auto;max-height:36px;border:0;outline:none;text-decoration:none;" />
                </td>
                <td align="right" style="vertical-align:middle;color:${colors.onPrimary};font-size:12px;letter-spacing:0.06em;text-transform:uppercase;opacity:0.78;">
                  ${safeBrandName} · ${safeJurisdiction}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 8px;color:${colors.text};font-size:15px;line-height:1.7;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 36px 32px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top:1px solid ${colors.divider};">
              <tr><td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>
            </table>
            ${signatureHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 36px 28px;background:${colors.mutedBg};border-top:1px solid ${colors.divider};color:${colors.textMuted};font-size:11px;line-height:1.6;">
            <div style="margin-bottom:6px;">This message was sent by ${safeBrandName} ${safeJurisdiction}. ${escapeHtml(brand.signature.regulatorLine || 'Regulated insurance intermediary.')}</div>
            <div>© ${year} ${safeBrandName}. All rights reserved.</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function renderSignatureBlock(brand: BrandProfile): string {
  const { colors, signature } = brand;
  const safeBrandName = escapeHtml(brand.brandName);
  const legal = signature.legalLines
    .map((line) => `<div style="margin:0;">${escapeHtml(line)}</div>`)
    .join('');
  const address = signature.addressLines
    .map((line) => `<div style="margin:0;">${escapeHtml(line)}</div>`)
    .join('');
  const regulator = signature.regulatorLine
    ? `<div style="margin-top:8px;color:${colors.textMuted};">${escapeHtml(signature.regulatorLine)}</div>`
    : '';
  const website = signature.websiteUrl && signature.websiteLabel
    ? `<div style="margin-top:8px;"><a href="${escapeAttr(signature.websiteUrl)}" style="color:${colors.accent};text-decoration:none;font-weight:600;">${escapeHtml(signature.websiteLabel)}</a></div>`
    : '';
  const hours = signature.hours
    ? `<div style="margin-top:10px;color:${colors.textMuted};font-style:italic;">${escapeHtml(signature.hours)}</div>`
    : '';

  const phoneRows = signature.phones
    .map((entry) => renderPhoneRow(entry, colors))
    .join('');

  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${colors.mutedBg};border:1px solid ${colors.divider};border-radius:14px;">
  <tr>
    <td style="padding:24px 28px 6px;">
      <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${colors.textMuted};font-weight:700;">Kind regards</div>
      <div style="margin-top:6px;font-size:18px;color:${colors.text};font-weight:700;">The ${safeBrandName} Team</div>
    </td>
  </tr>
  <tr>
    <td style="padding:0 28px 18px;color:${colors.text};font-size:13px;line-height:1.65;">
      <div style="margin-top:14px;">${legal}</div>
      <div style="margin-top:10px;">${address}</div>
      ${regulator}
      ${website}
    </td>
  </tr>
  <tr>
    <td style="padding:0 28px 22px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top:1px solid ${colors.divider};">
        <tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>
      </table>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        ${phoneRows}
      </table>
      ${hours}
    </td>
  </tr>
</table>`;
}

function renderPhoneRow(entry: BrandPhoneEntry, colors: BrandColors): string {
  const safeLabel = escapeHtml(entry.label);
  const safeDisplay = escapeHtml(entry.display);
  const telHref = escapeAttr(`tel:${entry.tel}`);
  const linkParts: string[] = [
    `<a href="${telHref}" style="color:${colors.text};text-decoration:none;font-weight:600;">${safeDisplay}</a>`,
  ];
  if (entry.whatsapp) {
    const waHref = escapeAttr(`https://wa.me/${entry.whatsapp}`);
    linkParts.push(
      `<a href="${waHref}" style="color:${colors.accent};text-decoration:none;font-weight:600;margin-left:8px;">Open WhatsApp →</a>`,
    );
  }
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:${colors.textMuted};vertical-align:top;width:55%;">${safeLabel}</td>
    <td style="padding:6px 0;font-size:13px;color:${colors.text};vertical-align:top;text-align:right;">${linkParts.join(' ')}</td>
  </tr>`;
}

// ────────────────────────────────────────────────────────────────────────────
// Variable expansion (for templates that still reference brand variables)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convenience: produce the brand-scoped variables that callers can merge
 * into their template variables so legacy `{{brandName}}` / `{{brand.*}}`
 * placeholders inside DB overrides resolve correctly.
 */
export function brandVariables(brand: BrandProfile): Record<string, unknown> {
  return {
    brandName: brand.brandName,
    brand: {
      name: brand.brandName,
      jurisdiction: brand.signature.jurisdiction,
      logoUrl: brand.logoUrl,
      website: brand.signature.websiteUrl ?? '',
      fromEmail: brand.fromEmail,
      publicBaseUrl: brand.publicBaseUrl,
    },
  };
}

/**
 * Expand any brand variables in the given template string. This is used by
 * the renderer to neutralise legacy `{{brandName}}` references that may live
 * inside database template overrides authored before brand resolution moved
 * to the wrapper.
 */
export function expandBrandPlaceholders(template: string, brand: BrandProfile): string {
  return renderTemplate(template, brandVariables(brand)).rendered;
}
