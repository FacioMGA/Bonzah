#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const STRICT = String(process.env.STRICT_VALIDATION_CONTRACT || '') === '1';
const AUDIT_JSON_PATH = path.join(ROOT, 'artifacts', 'contracts', 'motor-validation-contract.audit.json');

function runGenerateCheck() {
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(
    bin,
    ['tsx', 'tools/quality/generateValidationContractArtifacts.ts', '--check'],
    { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' },
  );
  return result;
}

function parseAudit() {
  if (!fs.existsSync(AUDIT_JSON_PATH)) return null;
  return JSON.parse(fs.readFileSync(AUDIT_JSON_PATH, 'utf8'));
}

const genCheck = runGenerateCheck();
const audit = parseAudit();
const messages = [];
let hasViolation = false;
const genOutput = `${String(genCheck.stdout || '')}\n${String(genCheck.stderr || '')}`;
const stalePaths = genOutput
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith('- '))
  .map((line) => line.replace(/^- /, '').trim());
const onlyAuditArtifactStale =
  stalePaths.length > 0 &&
  stalePaths.every((filePath) => filePath === 'artifacts/contracts/motor-validation-contract.audit.json');

if (genCheck.status !== 0) {
  if (onlyAuditArtifactStale) {
    messages.push('[validation-contract-parity] audit JSON artifact is stale/missing but treated as non-blocking.');
  } else {
    hasViolation = true;
    messages.push('[validation-contract-parity] generated artifacts are stale.');
    if (genCheck.stdout.trim()) messages.push(genCheck.stdout.trim());
    if (genCheck.stderr.trim()) messages.push(genCheck.stderr.trim());
  }
}

if (!audit) {
  // The audit JSON is generated under artifacts/ and commonly gitignored.
  // When only that artifact is stale, keep this guard non-blocking.
  if (genCheck.status !== 0 && !onlyAuditArtifactStale) {
    hasViolation = true;
    messages.push('[validation-contract-parity] audit artifact missing: artifacts/contracts/motor-validation-contract.audit.json');
  }
} else {
  const quoteMissing = audit?.legacyDiff?.quoteReady?.missing?.length || 0;
  const quoteExtra = audit?.legacyDiff?.quoteReady?.extra?.length || 0;
  const issueMissing = audit?.legacyDiff?.issuanceRequired?.missing?.length || 0;
  const issueExtra = audit?.legacyDiff?.issuanceRequired?.extra?.length || 0;
  const missingContract = audit?.fieldsMissingContract?.length || 0;

  if (quoteMissing + quoteExtra + issueMissing + issueExtra + missingContract > 0) {
    hasViolation = true;
    messages.push(
      `[validation-contract-parity] parity drift detected: quoteDiff=${quoteMissing + quoteExtra}, issuanceDiff=${issueMissing + issueExtra}, ownershipWithoutContract=${missingContract}`,
    );
  }
}

if (hasViolation) {
  const body = messages.join('\n');
  if (STRICT) {
    console.error(`${body}\n[validation-contract-parity] STRICT mode enabled, failing.`);
    process.exit(1);
  }
  console.warn(`${body}\n[validation-contract-parity] advisory mode (set STRICT_VALIDATION_CONTRACT=1 to enforce).`);
  process.exit(0);
}

console.log('[validation-contract-parity] OK');

