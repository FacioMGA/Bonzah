// tools/docs/lib/git.mjs
//
// Tiny helper: return a stable content revision for a tracked file or
// directory. Git commit dates are not stable across GitHub's synthetic merge
// and the resulting squash commit, so generated inventory metadata must not
// depend on history or committer timezone.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function hashPath(repoRelativePath) {
  const hash = createHash('sha256');
  // A workspace can gain generated or tool-owned files while CI runs. Use
  // Git's tracked-file list, but hash the working file contents so callers can
  // regenerate the inventory before staging a source edit.
  const listing = execFileSync(
    'git',
    ['ls-files', '-z', '--', repoRelativePath],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  if (!listing.trim()) {
    throw new Error(`No tracked content found at ${repoRelativePath}`);
  }
  for (const filePath of listing.split('\0').filter(Boolean).sort()) {
    hash.update(filePath);
    hash.update('\0');
    hash.update(readFileSync(join(process.cwd(), filePath)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function lastChangedFor(repoRelativePath) {
  try {
    // A squash merge rewrites commit ancestry and timestamps although the
    // source content is unchanged. Generated inventory metadata must be a
    // property of tracked content, not of tool-owned files or the merge
    // strategy used to land it.
    const revision = hashPath(repoRelativePath).slice(0, 12);
    return { date: null, sha: revision, raw: `content:${revision}` };
  } catch {
    return { date: null, sha: null, raw: 'unknown' };
  }
}
