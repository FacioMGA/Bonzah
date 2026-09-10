/**
 * Regression test for `guard:domain-purity`.
 *
 * Before this fix, three files under `backend/modules/<m>/domain/` reached
 * for `@prisma/client` (type-only) or `backend/platform/db/connection.js`
 * (runtime), violating the architectural invariant that `domain/` is the
 * pure-rules layer:
 *
 *   - backend/modules/claims/domain/commands/shared.ts
 *   - backend/modules/claims/domain/worksheetProjection.ts
 *   - backend/modules/documents/domain/DocumentService.ts
 *
 * The fix:
 *   1. Adds curated Prisma `Unchecked*Input` aliases to
 *      `backend/platform/types/prisma.ts` (the single platform-side
 *      indirection allowed to import `@prisma/client`). Domain modules
 *      that need a Prisma input shape import the named alias from there.
 *   2. Moves `DocumentService` from `domain/` to `app/` because it
 *      orchestrates DB + queue + product-registry side-effects (i.e. it
 *      was an application service mis-located in `domain/`).
 *
 * This test pins the boundary so a careless `import { Prisma } from
 * '@prisma/client'` inside `backend/modules/<m>/domain/**` will fail in
 * CI before the guard even runs.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MODULES_DIR = path.join(REPO_ROOT, 'backend', 'modules');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('domain purity (regression)', () => {
  const domainFiles = walk(MODULES_DIR).filter((f) => {
    const rel = path.relative(REPO_ROOT, f).replaceAll('\\', '/');
    return rel.includes('/domain/') && !rel.includes('/__tests__/');
  });

  it('discovers some domain files (sanity — no zero-coverage regression)', () => {
    expect(domainFiles.length).toBeGreaterThan(20);
  });

  it('no `domain/**` file imports `@prisma/client` directly', () => {
    const offenders: string[] = [];
    for (const file of domainFiles) {
      const src = readFileSync(file, 'utf8');
      // Match `from '@prisma/client'` in any import (including type-only).
      if (/from\s+['"]@prisma\/client['"]/.test(src)) {
        offenders.push(path.relative(REPO_ROOT, file).replaceAll('\\', '/'));
      }
    }
    expect(offenders, `domain files importing @prisma/client directly:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('no `domain/**` file imports the platform DB connection', () => {
    const offenders: string[] = [];
    for (const file of domainFiles) {
      const src = readFileSync(file, 'utf8');
      if (/from\s+['"][^'"]*\/platform\/db\/connection[^'"]*['"]/.test(src)) {
        offenders.push(path.relative(REPO_ROOT, file).replaceAll('\\', '/'));
      }
    }
    expect(offenders, `domain files importing platform/db/connection:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
