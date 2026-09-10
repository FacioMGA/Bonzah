// tools/docs/lib/frontmatter.mjs
//
// Tiny YAML-frontmatter parser/serialiser used by the docs generators and
// docs guards. Intentionally small and dependency-free — frontmatter in
// this repo is a flat object of strings/numbers/booleans, never nested.

const FENCE = '---';

export function parseFrontmatter(raw) {
  if (typeof raw !== 'string') {
    return { frontmatter: null, body: '' };
  }
  if (!raw.startsWith(`${FENCE}\n`) && !raw.startsWith(`${FENCE}\r\n`)) {
    return { frontmatter: null, body: raw };
  }
  const lines = raw.split(/\r?\n/);
  const closeIdx = lines.findIndex((line, idx) => idx > 0 && line.trim() === FENCE);
  if (closeIdx === -1) {
    return { frontmatter: null, body: raw };
  }
  const yamlLines = lines.slice(1, closeIdx);
  const body = lines.slice(closeIdx + 1).join('\n').replace(/^\n+/, '');
  const frontmatter = {};
  for (const line of yamlLines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^-?\d+$/.test(value)) value = Number(value);
    else if (/^['"].*['"]$/.test(value)) value = value.slice(1, -1);
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

export function serializeFrontmatter(frontmatter) {
  const keys = Object.keys(frontmatter);
  const lines = keys.map((k) => {
    const v = frontmatter[k];
    if (typeof v === 'string') {
      const needsQuotes = /[:#]/.test(v) || v.trim() !== v;
      return `${k}: ${needsQuotes ? JSON.stringify(v) : v}`;
    }
    return `${k}: ${v}`;
  });
  return ['---', ...lines, '---', ''].join('\n');
}

// Frontmatter `reviewed:` is stamped with today's date at generation time so
// the freshness guard (tools/quality/check-docs-stale.mjs) stays satisfied.
// That makes it volatile day-to-day: a rebuild the day after a commit would
// otherwise register as spurious drift and turn `main` red at UTC midnight,
// stalling the automated deploy lane. Drift detection only cares whether the
// generated CONTENT changed, so we neutralize that one date line here. Actual
// freshness is enforced independently against the committed date.
const REVIEWED_LINE = /^reviewed: \d{4}-\d{2}-\d{2}$/m;

export function normalizeForCompare(content) {
  return (
    content
      .replace(/\r\n/g, '\n')
      .replace(REVIEWED_LINE, 'reviewed: <normalized>')
      .trimEnd() + '\n'
  );
}
