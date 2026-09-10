#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const artifactsDir = path.resolve(process.cwd(), process.env.CI_SUMMARY_ARTIFACTS_DIR || '.ci/quality-artifacts');
const qualityResult = String(process.env.QUALITY_RESULT || '').trim().toLowerCase();
const runReleaseBlockingSmoke = ['1', 'true', 'yes'].includes(String(process.env.RUN_RELEASE_BLOCKING_SMOKE || '').toLowerCase());
const runBackupRestoreValidate = ['1', 'true', 'yes'].includes(String(process.env.RUN_BACKUP_RESTORE_VALIDATE || '').toLowerCase());

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function pushIf(arr, value) {
  if (value) arr.push(value);
}

const quoteSmokePath = path.join(artifactsDir, 'quote-bind-issue-smoke.json');
const releaseSmokePath = path.join(artifactsDir, 'release-blocking-smoke.json');
const backupRestorePath = path.join(artifactsDir, 'backup-restore-validation.json');
const goNoGoPath = path.join(artifactsDir, 'go-no-go-evidence-packet.json');
const backendArchitecturePath = path.join(artifactsDir, 'backend-architecture-conformance.json');

const quoteSmoke = readJsonIfExists(quoteSmokePath);
const releaseSmoke = readJsonIfExists(releaseSmokePath);
const backupRestore = readJsonIfExists(backupRestorePath);
const goNoGo = readJsonIfExists(goNoGoPath);

const passedChecks = [];
const warnings = [];
const skippedChecks = [];
const releaseBlockers = [];
const evidenceArtifacts = [];

if (qualityResult === 'success') {
  passedChecks.push(
    'Dependency, vulnerability, and secret-scanning gates',
    'Lint, architecture, import-zone, and purity ratchets',
    'Type-check, build-contract, and public-bundle isolation proofs',
    'Contract, adapter, journey, and smoke evidence generation',
  );
} else {
  releaseBlockers.push(`Reusable quality gate result: ${qualityResult || 'unknown'}`);
}

if (quoteSmoke?.skipped) {
  skippedChecks.push(`Quote-bind smoke: Not evaluated (${quoteSmoke.skipReason || 'skipped'})`);
} else if (quoteSmoke?.passed === false) {
  releaseBlockers.push(`Quote-bind smoke failed: ${quoteSmoke.error || 'unknown error'}`);
}

if (!runReleaseBlockingSmoke) {
  skippedChecks.push('Release-blocking smoke: Not evaluated (RUN_RELEASE_BLOCKING_SMOKE disabled)');
} else if (releaseSmoke?.status === 'not-generated') {
  skippedChecks.push(`Release-blocking smoke: Not evaluated (${releaseSmoke.reason || 'artifact not generated'})`);
} else if (Array.isArray(releaseSmoke?.checks)) {
  for (const check of releaseSmoke.checks) {
    if (check?.status === 'warning') {
      warnings.push(`${check.name}: ${check.error || 'warning'}`);
    }
    if (check?.status === 'failed' && check?.blocking !== false) {
      releaseBlockers.push(`${check.name}: ${check.error || 'failed'}`);
    }
  }
}

if (!runBackupRestoreValidate) {
  skippedChecks.push('Backup/restore validation: Not evaluated (RUN_BACKUP_RESTORE_VALIDATE disabled)');
} else if (backupRestore?.status === 'not-generated') {
  skippedChecks.push(`Backup/restore validation: Not evaluated (${backupRestore.reason || 'artifact not generated'})`);
}

if (goNoGo?.missingRequired?.length) {
  for (const key of goNoGo.missingRequired) {
    releaseBlockers.push(`Evidence packet missing required section: ${key}`);
  }
}

pushIf(evidenceArtifacts, fileExists(quoteSmokePath) ? 'quote-bind-issue smoke artifact' : '');
pushIf(evidenceArtifacts, fileExists(releaseSmokePath) ? 'release-blocking smoke artifact' : '');
pushIf(evidenceArtifacts, fileExists(backupRestorePath) ? 'backup/restore validation artifact' : '');
pushIf(evidenceArtifacts, fileExists(goNoGoPath) ? 'go/no-go evidence packet' : '');
pushIf(evidenceArtifacts, fileExists(backendArchitecturePath) ? 'backend architecture conformance artifact' : '');

const lines = [
  '## CI Quality Summary',
  '',
  `- Overall result: \`${qualityResult || 'unknown'}\``,
  '',
  '### Passed checks',
  ...(passedChecks.length ? passedChecks.map((line) => `- ${line}`) : ['- None recorded.']),
  '',
  '### Warnings',
  ...(warnings.length ? warnings.map((line) => `- ${line}`) : ['- None.']),
  '',
  '### Skipped checks',
  ...(skippedChecks.length ? skippedChecks.map((line) => `- ${line}`) : ['- None.']),
  '',
  '### Release blockers',
  ...(releaseBlockers.length ? releaseBlockers.map((line) => `- ${line}`) : ['- None.']),
  '',
  '### Evidence artifacts generated',
  ...(evidenceArtifacts.length ? evidenceArtifacts.map((line) => `- ${line}`) : ['- None detected.']),
  '',
];

const markdown = `${lines.join('\n')}\n`;
if (summaryPath) {
  fs.appendFileSync(summaryPath, markdown, 'utf8');
}
process.stdout.write(markdown);
