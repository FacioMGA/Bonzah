#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';

const artifactPath = String(process.env.ISSUE_READINESS_AUDIT_ARTIFACT || '/tmp/issue-readiness-audit.json').trim();
const baseRef = String(process.env.ISSUE_READINESS_BASE_REF || 'origin/main').trim();
const appBaseUrl = String(process.env.APP_BASE_URL || process.env.AKS_API_BASE_URL || '').trim().replace(/\/$/, '');
const policyId = String(process.env.ISSUE_READINESS_AUDIT_POLICY_ID || '').trim();
const publicToken = String(process.env.ISSUE_READINESS_AUDIT_PUBLIC_TOKEN || '').trim();

const scopeFiles = [
  'prisma/schema.prisma',
  'backend/core/policy/issueReadinessUpdater.ts',
  'backend/http/routes/policies/binding.ts',
  'backend/core/events/queue.ts',
  'backend/http/routes/paymentsCardcorp.ts',
  'backend/services/publicAutoQuote/controller.ts',
];

function sh(command) {
  return execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
}

async function request(url, headers = {}) {
  const res = await fetch(url, { headers });
  const txt = await res.text();
  let body = null;
  try {
    body = txt ? JSON.parse(txt) : null;
  } catch {
    body = { raw: txt };
  }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body };
}

const out = {
  generatedAt: new Date().toISOString(),
  baseRef,
  scopeFiles,
  diff: [],
  etagCheck: {
    attempted: false,
    firstStatus: null,
    secondStatus: null,
    etag: null,
    passed304Check: null,
    payloadSample: null,
  },
  rollback: {
    documentedSwitches: [
      'ISSUE_READINESS_BASE_REF',
      'ISSUE_READINESS_AUDIT_POLICY_ID',
      'ISSUE_READINESS_AUDIT_PUBLIC_TOKEN',
      'ISSUE_READINESS_FALLBACK_ENABLED',
    ],
    fallbackFlagValue: String(process.env.ISSUE_READINESS_FALLBACK_ENABLED || ''),
  },
  pass: true,
  notes: [],
};

try {
  const availableBaseRef = sh(`git rev-parse --verify ${baseRef}`);
  out.notes.push(`Using base ref ${baseRef} (${availableBaseRef.slice(0, 12)})`);
} catch {
  out.notes.push(`Base ref ${baseRef} not found locally; trying main`);
}

for (const file of scopeFiles) {
  let changed = false;
  let additions = 0;
  let deletions = 0;
  try {
    const stat = sh(`git diff --numstat ${baseRef}...HEAD -- "${file}"`);
    if (stat) {
      const [a, d] = stat.split(/\s+/);
      additions = Number(a) || 0;
      deletions = Number(d) || 0;
      changed = additions + deletions > 0;
    }
  } catch {
    // keep defaults
  }
  out.diff.push({ file, changed, additions, deletions });
}

if (appBaseUrl && policyId) {
  try {
    out.etagCheck.attempted = true;
    const headers = {};
    if (publicToken) headers['x-public-session-token'] = publicToken;
    const url = `${appBaseUrl}/api/public/motor/session/${policyId}/issue-readiness`;
    const first = await request(url, headers);
    out.etagCheck.firstStatus = first.status;
    out.etagCheck.payloadSample = first.body;
    const etag = first.headers.etag || null;
    out.etagCheck.etag = etag;
    if (etag) {
      const second = await request(url, { ...headers, 'if-none-match': etag });
      out.etagCheck.secondStatus = second.status;
      out.etagCheck.passed304Check = second.status === 304;
      if (second.status !== 304) {
        out.pass = false;
        out.notes.push('ETag 304 behavior did not return 304 on second request.');
      }
    } else {
      out.pass = false;
      out.notes.push('Missing ETag header on issue-readiness endpoint.');
    }
  } catch (error) {
    out.pass = false;
    out.notes.push(`ETag check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
} else {
  out.notes.push('ETag check skipped (APP_BASE_URL or ISSUE_READINESS_AUDIT_POLICY_ID missing).');
}

const changedCriticalFiles = out.diff.filter((d) => d.changed).length;
if (changedCriticalFiles === 0) {
  out.notes.push('No scoped issue-readiness files differ from baseline ref.');
}

await fs.writeFile(artifactPath, JSON.stringify(out, null, 2), 'utf8');
if (!out.pass) {
  console.error(`[issue-readiness-audit] failed. See artifact ${artifactPath}`);
  process.exit(1);
}
console.log(`[issue-readiness-audit] ok. Artifact ${artifactPath}`);

