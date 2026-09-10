/**
 * Static lint for a rendered email (Email Preview & Testing Centre).
 *
 * Pure functions that inspect already-rendered subject/body/HTML and flag the
 * problems reviewers care about before a template is approved: unresolved
 * variables, broken/placeholder links, and a missing brand logo. No network
 * access — link "reachability" is not checked here, only structural validity.
 */

export interface EmailLintFinding {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  detail?: string;
}

export interface EmailLintInput {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  /** Brand logo URL used in the header (from the BrandProfile). */
  logoUrl?: string;
  /** Attachment filenames the template is expected to carry, if any. */
  expectedAttachments?: string[];
  /** Attachment filenames actually resolved for this preview. */
  resolvedAttachments?: string[];
}

const UNRESOLVED_PLACEHOLDER = /\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/g;

/** Extract href="" and src="" targets from an HTML string. */
export function extractHtmlLinks(html: string): string[] {
  const out: string[] = [];
  const attrPattern = /(?:href|src)\s*=\s*"([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = attrPattern.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/**
 * A link is "broken" for an email if it is empty, a bare anchor, still
 * contains an unresolved placeholder, or is a relative path (email clients
 * cannot resolve relative URLs — they must be absolute). `mailto:` and `tel:`
 * are allowed.
 */
export function isBrokenEmailLink(url: string): boolean {
  const v = String(url || '').trim();
  if (!v) return true;
  if (v === '#') return true;
  if (v.includes('{{') || v.includes('}}')) return true;
  if (/^(mailto:|tel:)/i.test(v)) return false;
  if (/^https?:\/\//i.test(v)) return false;
  if (/^(cid:|data:)/i.test(v)) return false;
  // Anything else (relative path, protocol-relative, empty scheme) is broken.
  return true;
}

export function lintRenderedEmail(input: EmailLintInput): EmailLintFinding[] {
  const findings: EmailLintFinding[] = [];

  const unresolved = Array.from(
    new Set([
      ...(input.subject.match(UNRESOLVED_PLACEHOLDER) || []),
      ...(input.bodyText.match(UNRESOLVED_PLACEHOLDER) || []),
    ]),
  );
  if (unresolved.length > 0) {
    findings.push({
      code: 'UNRESOLVED_VARIABLES',
      severity: 'error',
      message: 'Template has unresolved variables',
      detail: unresolved.join(', '),
    });
  }

  const brokenLinks = extractHtmlLinks(input.bodyHtml).filter((u) => isBrokenEmailLink(u));
  if (brokenLinks.length > 0) {
    findings.push({
      code: 'BROKEN_LINKS',
      severity: 'error',
      message: 'Template contains broken or non-absolute links',
      detail: brokenLinks.join(', '),
    });
  }

  const logo = String(input.logoUrl || '').trim();
  if (!logo || logo.includes('{{') || !/^https?:\/\//i.test(logo)) {
    findings.push({
      code: 'MISSING_LOGO',
      severity: 'warning',
      message: 'Brand logo URL is missing or not absolute',
      detail: logo || '(empty)',
    });
  }

  const expected = input.expectedAttachments || [];
  const resolved = new Set(input.resolvedAttachments || []);
  const missingAttachments = expected.filter((name) => !resolved.has(name));
  if (missingAttachments.length > 0) {
    findings.push({
      code: 'MISSING_ATTACHMENTS',
      severity: 'error',
      message: 'Expected attachments are unavailable',
      detail: missingAttachments.join(', '),
    });
  }

  return findings;
}
