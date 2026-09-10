#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const freezeActive = ['1', 'true', 'yes'].includes(
  String(process.env.RELEASE_FREEZE_ACTIVE || '').trim().toLowerCase(),
);
const requireReleasePr = !['0', 'false', 'no'].includes(
  String(process.env.RELEASE_FREEZE_REQUIRE_RELEASE_PR || 'true').trim().toLowerCase(),
);
const releaseHeadPattern = new RegExp(
  String(process.env.RELEASE_FREEZE_HEAD_REF_REGEX || '^release\\/').trim(),
);

if (!freezeActive) {
  console.log('[remediation-freeze] skipped (RELEASE_FREEZE_ACTIVE is not enabled)');
  process.exit(0);
}

function run(command) {
  return String(execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] }))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function readPullRequestText() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return '';
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    const pr = event?.pull_request || {};
    return [pr.title || '', pr.body || ''].join('\n').trim();
  } catch {
    return '';
  }
}

function getChangedFiles() {
  try {
    return run('git fetch origin main --depth=1 >/dev/null 2>&1; git diff --name-only origin/main...HEAD');
  } catch {
    return run('git diff --name-only HEAD~1...HEAD');
  }
}

function readCiPrContext() {
  return {
    eventName: String(process.env.GITHUB_EVENT_NAME || '').trim(),
    headRef: String(process.env.GITHUB_HEAD_REF || '').trim(),
    baseRef: String(process.env.GITHUB_BASE_REF || '').trim(),
  };
}

const remediationTicket =
  String(process.env.REMEDIATION_TICKET_ID || '').trim() || readPullRequestText();

const hasTicketRef = /(REM|SEC|OPS|HOTFIX)-\d+|#\d+/i.test(remediationTicket);
if (!hasTicketRef) {
  console.error(
    '[remediation-freeze] FAILED: missing remediation ticket reference (set REMEDIATION_TICKET_ID or include ticket in PR title/body).',
  );
  process.exit(1);
}

if (requireReleasePr) {
  const ci = readCiPrContext();
  const isReleasePr =
    ci.eventName === 'pull_request' &&
    ci.baseRef === 'main' &&
    releaseHeadPattern.test(ci.headRef);
  if (!isReleasePr) {
    console.error(
      '[remediation-freeze] FAILED: freeze guard only runs on release/* -> main pull requests when active.',
    );
    process.exit(1);
  }
}

const dirty = run('git status --porcelain');
if (dirty.length > 0) {
  console.error('[remediation-freeze] FAILED: git worktree must be clean in release freeze checks.');
  process.exit(1);
}

const allowlist = [
  /^backend\/http\/middleware\/(rls|auth|policyAccess|logger)\.ts$/,
  /^backend\/modules\/communications\/http\/webhooksRouter\.ts$/,
  /^backend\/modules\/communications\/domain\/webhooks\/webhookDispatcher\.ts$/,
  /^backend\/index\.ts$/,
  /^backend\/platform\/test\/security\/.*\.test\.ts$/,
  /^backend\/.*__tests__\/.*\.test\.ts$/,
  /^tools\/quality\/aks\/.*\.(mjs|ts|sh)$/,
  /^tools\/quality\/scan-secrets\.mjs$/,
  /^tools\/quality\/check-outbound-http-boundary\.mjs$/,
  /^tools\/quality\/tests\/.*\.(mjs|sh|ts)$/,
  /^tools\/quality\/testEndToEndApi\.sh$/,
  /^tools\/quality\/check-remediation-freeze\.mjs$/,
  /^\.github\/workflows\/(ci|azure-images|aks-deploy)\.yml$/,
  /^tools\/quality\/ci\/run-quality-gate\.mjs$/,
  /^infrastructure\/k8s\/helm\/abbeygate\/(values\.yaml|templates\/migration-job\.yaml)$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^docs\/architecture\/production-remediation-plan-2026-03\.md$/,
  /^docs\/runbooks\/aks-rollback-2026-03\.md$/,
];

const changed = getChangedFiles();
const disallowed = changed.filter((file) => !allowlist.some((rule) => rule.test(file)));

if (disallowed.length > 0) {
  console.error('[remediation-freeze] FAILED: disallowed file changes during freeze window:');
  for (const file of disallowed) console.error(` - ${file}`);
  process.exit(1);
}

console.log('[remediation-freeze] OK');
