// tools/docs/lib/git.mjs
//
// Tiny helper: return the most recent effective git commit date for a path.
// Falls back to the current ISO date when git is unavailable (e.g. a fresh
// clone in a sandbox), so generators stay deterministic but never crash.
//
// IMPORTANT — the date is rendered in UTC (fixed `+0000` offset), NOT the
// committer's local timezone. Git's `%ci` embeds the committer timezone
// (e.g. `+0300` locally, `+0000` for a GitHub squash-merge commit), which made
// this generated column drift the instant a PR was squash-merged: the branch
// commit carried the author's local offset, the squash commit carried UTC, so
// `docs:generate:check` went red on `main` and — because the deploy gate
// requires a green CI for the SHA — silently blocked every deployment. Pinning
// to UTC makes the value independent of the author's timezone.
//
// A PR can also change a path and later restore it before squash merge. GitHub
// checks a synthetic merge commit, whereas main receives only the net squash
// change. For a path with no net diff from main, read its history from the
// merge base so both contexts generate the same inventory.

import { execFileSync } from 'node:child_process';

function verifiedRef(ref) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
      ? ref
      : null;
  } catch {
    return null;
  }
}

function mainRef() {
  const explicitRef = process.env.DOCS_BASE_REF;
  for (const ref of [explicitRef, 'origin/main', 'main']) {
    if (ref && verifiedRef(ref)) return ref;
  }

  try {
    const remoteMainRefs = execFileSync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter((ref) => ref.endsWith('/main'))
      .sort();
    return remoteMainRefs[0] ?? null;
  } catch {
    return null;
  }
}

function effectiveHistory(repoRelativePath) {
  const baseRef = mainRef();
  if (!baseRef) return { ref: 'HEAD', fullHistory: true };

  try {
    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', baseRef], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    execFileSync('git', ['diff', '--quiet', `${mergeBase}..HEAD`, '--', repoRelativePath], {
      stdio: 'ignore',
    });
    return { ref: mergeBase, fullHistory: false };
  } catch {
    return { ref: 'HEAD', fullHistory: true };
  }
}

export function lastChangedFor(repoRelativePath) {
  try {
    const history = effectiveHistory(repoRelativePath);
    // `--date=format-local:%Y-%m-%d` + TZ=UTC renders the committer date as a
    // UTC calendar date; the offset is therefore always `+0000`.
    const out = execFileSync(
      'git',
      [
        'log',
        '-1',
        ...(history.fullHistory ? ['--full-history'] : []),
        history.ref,
        '--date=format-local:%Y-%m-%d',
        '--pretty=format:%cd',
        '--',
        repoRelativePath,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, TZ: 'UTC' } },
    ).trim();
    if (!out) {
      return { date: null, sha: null, raw: 'never' };
    }
    const date = out.split(' ')[0];
    return { date, sha: '+0000', raw: `${date} (+0000)` };
  } catch {
    return { date: null, sha: null, raw: 'unknown' };
  }
}
