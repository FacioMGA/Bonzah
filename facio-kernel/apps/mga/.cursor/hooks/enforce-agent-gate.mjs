#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const stampPath = path.join(rootDir, '.cursor', 'cache', 'agent-gate-stamp.json');
const ttlHours = Number(process.env.AGENT_GATE_TTL_HOURS || 12);

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}

function jsonResponse(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function git(args) {
  return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function currentWorkspaceFingerprint() {
  return execFileSync(process.execPath, ['tools/quality/compute-repo-fingerprint.mjs', rootDir], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}

function commandIsRisky(command) {
  if (!command) return false;
  const riskyPatterns = [
    /\bgit\s+push\b/,
    /\bgh\s+workflow\s+run\b/,
    /\bhelm\s+(upgrade|install|rollback)\b/,
    /\bkubectl\s+(apply|rollout|set\s+image|scale|delete)\b/,
    /\baz\s+aks\s+command\s+invoke\b/,
    /\bnpm\s+run\s+(deploy|release)\b/,
    /tools\/quality\/aks\/run-prod-rollout\.sh/,
    /tools\/maintenance\/deploy/i,
  ];
  return riskyPatterns.some((pattern) => pattern.test(command));
}

function loadStamp() {
  if (!fs.existsSync(stampPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(stampPath, 'utf8'));
  } catch {
    return null;
  }
}

function validateStamp(stamp) {
  if (!stamp) return { ok: false, reason: `No local gate stamp found at ${stampPath}.` };

  const generatedAt = Date.parse(String(stamp.generatedAt || ''));
  const validUntil = Date.parse(String(stamp.validUntil || ''));
  const now = Date.now();
  if (!Number.isFinite(generatedAt) || !Number.isFinite(validUntil)) {
    return { ok: false, reason: 'Gate stamp is malformed. Re-run npm run gate:agent.' };
  }
  if (now > validUntil) {
    return {
      ok: false,
      reason: `Gate stamp is older than ${ttlHours}h. Re-run npm run gate:agent.`,
    };
  }

  let headSha = '';
  let workspaceFingerprint = '';
  try {
    headSha = git(['rev-parse', 'HEAD']);
    workspaceFingerprint = currentWorkspaceFingerprint();
  } catch (error) {
    return {
      ok: false,
      reason: `Unable to inspect git state for agent gate enforcement: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (headSha !== String(stamp.headSha || '')) {
    if (workspaceFingerprint === String(stamp.workspaceFingerprint || '')) {
      return { ok: true, reason: '' };
    }
    return {
      ok: false,
      reason: 'Current HEAD and workspace snapshot differ from the last passing local gate.',
    };
  }
  return { ok: true, reason: '' };
}

const inputRaw = await readStdin();
let input;
try {
  input = inputRaw ? JSON.parse(inputRaw) : {};
} catch {
  jsonResponse({
    permission: 'deny',
    user_message: 'Agent gate hook could not parse the shell request. Re-run npm run gate:agent or inspect .cursor/hooks/enforce-agent-gate.mjs.',
    agent_message: 'beforeShellExecution input JSON was invalid.',
  });
  process.exit(0);
}

const command = String(input.command || '').trim();
if (!commandIsRisky(command)) {
  jsonResponse({ permission: 'allow' });
  process.exit(0);
}

const stamp = loadStamp();
const validation = validateStamp(stamp);
if (validation.ok) {
  jsonResponse({ permission: 'allow' });
  process.exit(0);
}

jsonResponse({
  permission: 'deny',
  user_message: `${validation.reason} Run \`npm run gate:agent\` before push or deploy-style commands.`,
  agent_message: `Blocked risky shell command until the local agent gate passes. Command: ${command}`,
});
