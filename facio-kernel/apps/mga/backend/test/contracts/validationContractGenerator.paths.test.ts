/**
 * Regression test for the validation contract generator path repointing.
 *
 * Before this fix, `tools/quality/generateValidationContractArtifacts.ts`
 * imported / referenced files at:
 *
 *   frontend/src/products/policies/config/motorQuestionnaireContract
 *   frontend/src/products/policies/questionnaire/contract/...
 *
 * but those paths had been relocated to `frontend/src/modules/policies/...`,
 * causing `npm run guard:validation-contract-parity:strict` to crash with
 * `ERR_MODULE_NOT_FOUND` and the artifact-parity guard to fail in CI.
 *
 * The fix repoints the generator's source-of-truth references at the live
 * paths (`modules/policies/...`). This test pins those paths so the
 * generator and the live source tree never drift apart again.
 *
 * It deliberately reads the generator script as text (not via import) so
 * that even a future refactor that introduces dynamic path construction
 * still has to satisfy "every quoted path string in the generator must
 * exist on disk".
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GENERATOR = path.join(
  REPO_ROOT,
  'tools',
  'quality',
  'generateValidationContractArtifacts.ts',
);

describe('validation contract generator — path integrity (regression)', () => {
  const source = readFileSync(GENERATOR, 'utf8');

  it('does not reference the retired `frontend/src/products/policies/...` location', () => {
    const offenders = source.match(/frontend\/src\/products\/policies\/[^'"\s]+/g) ?? [];
    expect(offenders, `Generator still references retired path(s): ${offenders.join(', ')}`).toEqual([]);
  });

  it('every generated product artifact path string in the generator resolves on disk', () => {
    // Capture package source paths inside string/template/backtick delimiters,
    // excluding both the delimiter and any escape backslash so that audit-
    // markdown templates like `\`packages/products/...\`` don't pick up the
    // trailing escape character.
    const matches = Array.from(source.matchAll(/(['"`])(packages\/products\/src\/[^'"`\\]+?)\1/g));
    expect(matches.length, 'expected the generator to reference generated product artifact paths').toBeGreaterThan(0);

    const missing: string[] = [];
    for (const [, , relPath] of matches) {
      if (relPath.includes('<')) continue;
      const abs = path.join(REPO_ROOT, relPath);
      // Files referenced by the generator end in `.ts`; some are bare module
      // specifiers without an extension (TS imports). Try both.
      if (!existsSync(abs) && !existsSync(`${abs}.ts`)) {
        missing.push(relPath);
      }
    }
    expect(missing, `Missing source files referenced by generator:\n  ${missing.join('\n  ')}`).toEqual([]);
  });
});
