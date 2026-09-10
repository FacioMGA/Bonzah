import fs from 'node:fs';
import { execSync } from 'node:child_process';

function run(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
  }).trim();
}

function maybeRun(cmd) {
  try {
    return run(cmd);
  } catch {
    return '';
  }
}

function parseGithubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  } catch {
    return null;
  }
}

export function resolveDiffRangeOrThrow() {
  if (process.env.GITHUB_ACTIONS !== 'true') return '';

  const event = parseGithubEvent();
  const headSha = process.env.GITHUB_SHA || maybeRun('git rev-parse HEAD');

  let baseSha = process.env.GITHUB_BASE_SHA || process.env.GITHUB_EVENT_BEFORE || '';
  if (!baseSha && event?.pull_request?.base?.sha) baseSha = String(event.pull_request.base.sha);
  if (!baseSha && event?.before) baseSha = String(event.before);

  if (baseSha && !/^0+$/.test(baseSha) && headSha) {
    const baseOk = maybeRun(`git rev-parse --verify ${baseSha}^{commit}`);
    const headOk = maybeRun(`git rev-parse --verify ${headSha}^{commit}`);
    if (baseOk && headOk) return `${baseSha}...${headSha}`;
  }

  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    const remoteRange = `origin/${baseRef}...HEAD`;
    const exists = maybeRun(`git rev-parse --verify origin/${baseRef}^{commit}`);
    if (exists) {
      try {
        run(`git merge-base origin/${baseRef} HEAD`);
        return remoteRange;
      } catch {
        // continue to fail-closed.
      }
    }
  }

  // Reusable workflow callers may not pass pull_request/push base metadata through
  // to workflow_call context. In that case, derive a strict range from git graph.
  const originMain = maybeRun('git rev-parse --verify origin/main^{commit}');
  const head = headSha || maybeRun('git rev-parse HEAD');
  if (originMain && head) {
    const mergeBase = maybeRun('git merge-base origin/main HEAD');
    if (mergeBase) {
      // Branch diverged from main: scan full branch delta.
      if (mergeBase !== head) return `${mergeBase}...${head}`;
      // Already on main tip (or equivalent): scan latest commit delta.
      const parent = maybeRun('git rev-parse --verify HEAD^');
      if (parent) return `${parent}...${head}`;
    }
  }

  throw new Error('Unable to resolve CI diff range from GitHub metadata. Failing closed.');
}

function parseNameStatus(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/).filter(Boolean);
      const status = String(parts[0] || '');
      const file = status.startsWith('R') ? String(parts[2] || '') : String(parts[1] || '');
      return { status, file };
    })
    .filter((x) => x.file);
}

export function readChangedNameStatus() {
  const range = resolveDiffRangeOrThrow();
  if (range) {
    return parseNameStatus(run(`git diff --name-status ${range} --`));
  }

  const staged = parseNameStatus(maybeRun('git diff --name-status --cached -- .'));
  const unstaged = parseNameStatus(maybeRun('git diff --name-status -- .'));
  const merged = new Map();
  for (const entry of [...staged, ...unstaged]) merged.set(`${entry.status}:${entry.file}`, entry);
  return [...merged.values()];
}

export function readUnifiedDiff() {
  const range = resolveDiffRangeOrThrow();
  if (range) return run(`git diff --no-color -U0 ${range} --`);
  return `${maybeRun('git diff --no-color -U0 --cached -- .')}\n${maybeRun('git diff --no-color -U0 -- .')}`;
}
