#!/usr/bin/env node
// tools/quality/check-express-request-augmentation-single-source.mjs
//
// Express Request augmentation single-source rule.
//
// Background: across this repo, four separate audit middlewares had each
// rewritten the same `declare global { namespace Express { interface Request
// { auditContext?: AuditContext; correlationId?: string } } }` block, plus a
// duplicate `RequestActor` alias and the same `(req as Request & { user?:
// RequestActor }).user` cast. That drift made `req.user` look like four
// different shapes and forced ~38 ad-hoc casts across HTTP handlers, even
// though `backend/platform/types/express.d.ts` already owned the surface.
//
// This guard enforces:
//   1. `declare global { namespace Express ... }` may only appear in files
//      listed in tools/quality/express-request-augmentation-allowlist.json.
//   2. None of those allowed files (other than the canonical owner) may
//      declare a property whose name appears on the canonical surface
//      (`user`, `correlationId`, `apiSurface`, `tenantId`, `apiAccount`,
//      `auditContext`). If a module needs to add a module-local property,
//      it MAY — but it must not shadow the canonical surface.
//   3. Files outside the allowlist may not write `(req as Request & { ... })`
//      casts that re-introduce one of the canonical properties; doing so is
//      either redundant (already typed) or proof of drift (re-declaring a
//      different shape).
//
// Companion to:
//   - check-no-new-any.mjs (DIFF_ANY_PATTERNS)
//   - check-any-resolved.mjs (resolved-any baseline)
//   - check-no-cross-layer-shadow-files.mjs

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ALLOWLIST_FILE = path.join(REPO_ROOT, 'tools', 'quality', 'express-request-augmentation-allowlist.json');

const SCAN_ROOT = path.join(REPO_ROOT, 'backend');
const SCAN_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

const DECLARE_NAMESPACE_RX = /declare\s+global\s*\{[\s\S]{0,400}?namespace\s+Express\s*\{/m;
const PROPERTY_LINE_RX = /^\s*(\w+)\s*\??\s*:/;

const config = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
const allowSet = new Set(config.allow);
const canonicalFile = config.canonicalFile;
const canonicalProps = new Set(config.canonicalProperties);

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else if (SCAN_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function rel(p) {
  return path.relative(REPO_ROOT, p).replaceAll('\\', '/');
}

function findAugmentationBlocks(text) {
  // Returns array of { props: string[], openLine: number } for each
  // `declare global { namespace Express { interface Request { ... } } }`
  // (or `interface Application`, etc.) block in the file.
  const blocks = [];
  const re = /declare\s+global\s*\{([\s\S]+?)\n\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const body = m[1];
    if (!/namespace\s+Express\b/.test(body)) continue;
    const interfaceRe = /interface\s+(\w+)\s*\{([\s\S]+?)\n\s{0,4}\}/g;
    let im;
    while ((im = interfaceRe.exec(body)) !== null) {
      const ifaceName = im[1];
      const propBody = im[2];
      const props = [];
      for (const line of propBody.split('\n')) {
        const pm = PROPERTY_LINE_RX.exec(line);
        if (pm) props.push(pm[1]);
      }
      blocks.push({ interface: ifaceName, props });
    }
  }
  return blocks;
}

function findRequestCasts(text) {
  // Detect `(req as Request & { … })` and `(args.req as Request & { … })`
  // casts that reintroduce a canonical property — pure laundering now that
  // the canonical augmentation is in place.
  const offenders = [];
  const re = /\(\s*\w+\s+as\s+Request\s*&\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const body = m[1];
    for (const propName of canonicalProps) {
      // Match `propName?:` or `propName:`
      const propRe = new RegExp(`\\b${propName}\\??\\s*:`);
      if (propRe.test(body)) {
        offenders.push({ snippet: m[0], property: propName });
        break;
      }
    }
  }
  return offenders;
}

function main() {
  const failures = [];
  const files = listFiles(SCAN_ROOT);

  // Pass 1: every namespace-Express declaration must be allowlisted, and
  // non-canonical allowlisted files must not redeclare canonical props.
  for (const file of files) {
    const relPath = rel(file);
    const text = fs.readFileSync(file, 'utf8');
    if (!DECLARE_NAMESPACE_RX.test(text)) continue;

    if (!allowSet.has(relPath)) {
      failures.push(
        `${relPath}: declares \`namespace Express\` but is not in tools/quality/express-request-augmentation-allowlist.json. ` +
        `Move the augmentation to ${canonicalFile} (the canonical owner) or, if the property is genuinely module-local, ` +
        `add this file to the allowlist with a one-line justification.`,
      );
      continue;
    }

    if (relPath === canonicalFile) continue;
    const blocks = findAugmentationBlocks(text);
    for (const block of blocks) {
      const overlap = block.props.filter((p) => canonicalProps.has(p));
      if (overlap.length > 0) {
        failures.push(
          `${relPath}: redeclares Express.${block.interface} property/properties already on the canonical surface ` +
          `(${overlap.join(', ')}). Remove them here; the canonical ${canonicalFile} owns them.`,
        );
      }
    }
  }

  // Pass 2: ad-hoc `(req as Request & { ... })` casts that re-introduce a
  // canonical property are pure laundering and forbidden everywhere.
  for (const file of files) {
    const relPath = rel(file);
    if (relPath === canonicalFile) continue;
    if (relPath.includes('/__tests__/') || /\.test\.tsx?$/.test(relPath)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const casts = findRequestCasts(text);
    for (const cast of casts) {
      failures.push(
        `${relPath}: cast \`${cast.snippet.slice(0, 80).replace(/\s+/g, ' ')}...\` re-introduces canonical property \`${cast.property}\`. ` +
        `Use plain \`req.${cast.property}\` — it is already typed by ${canonicalFile}.`,
      );
    }
  }

  if (failures.length > 0) {
    console.error('[express-augmentation-single-source] FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      `\nCanonical owner: ${canonicalFile}` +
      `\nCanonical properties: ${[...canonicalProps].join(', ')}` +
      `\nAllowlist (with justification per entry): ${path.relative(REPO_ROOT, ALLOWLIST_FILE)}`,
    );
    process.exit(1);
  }

  console.log(`[express-augmentation-single-source] OK — ${allowSet.size} allowed file(s), ${canonicalProps.size} canonical properties.`);
}

main();
