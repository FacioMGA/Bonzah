#!/usr/bin/env node
import fs from 'node:fs/promises';

const outputPath = String(process.env.GO_NO_GO_PACKET_PATH || '/tmp/go-no-go-evidence-packet.json').trim();

const evidenceFiles = [
  { key: 'releaseSmoke', path: String(process.env.RELEASE_SMOKE_ARTIFACT_PATH || '/tmp/release-blocking-smoke.json'), required: false },
  { key: 'postDeploySmoke', path: String(process.env.POSTDEPLOY_SMOKE_ARTIFACT_PATH || '/tmp/postdeploy-blocking-smoke.json'), required: true },
  { key: 'quoteBindSmoke', path: String(process.env.QUOTE_BIND_SMOKE_ARTIFACT_PATH || '/tmp/quote-bind-issue-smoke.json'), required: true },
  { key: 'backupPosture', path: String(process.env.BACKUP_POSTURE_REPORT_PATH || '/tmp/backup-posture.json'), required: true },
  { key: 'backupRestore', path: String(process.env.BACKUP_RESTORE_REPORT_PATH || '/tmp/backup-restore-validation.json'), required: false },
  { key: 'rollbackDrill', path: String(process.env.ROLLBACK_DRILL_REPORT_PATH || '/tmp/rollback-drill.json'), required: false },
  { key: 'issueReadinessAudit', path: String(process.env.ISSUE_READINESS_ARTIFACT_PATH || '/tmp/issue-readiness-audit.json'), required: true },
  { key: 'dbContractAudit', path: String(process.env.DB_CONTRACT_REPORT_PATH || '/tmp/runtime-db-contract.json'), required: true },
  { key: 'deployTimings', path: String(process.env.DEPLOY_TIMINGS_ARTIFACT_PATH || '/tmp/aks-stage-timings.jsonl'), required: true },
];

async function readIfExists(path) {
  try {
    const content = await fs.readFile(path, 'utf8');
    return { exists: true, content };
  } catch {
    return { exists: false, content: null };
  }
}

const sections = {};
for (const file of evidenceFiles) {
  const read = await readIfExists(file.path);
  let parsed = null;
  if (read.exists && read.content && (file.path.endsWith('.json') || file.path.endsWith('.jsonl'))) {
    try {
      if (file.path.endsWith('.jsonl')) {
        parsed = read.content
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } else {
        parsed = JSON.parse(read.content);
      }
    } catch {
      parsed = null;
    }
  }
  sections[file.key] = {
    path: file.path,
    required: file.required,
    present: read.exists,
    parsed,
  };
}

const packet = {
  createdAt: new Date().toISOString(),
  releaseSha: String(process.env.GITHUB_SHA || process.env.RELEASE_SHA || '').trim(),
  repository: String(process.env.GITHUB_REPOSITORY || '').trim(),
  runId: String(process.env.GITHUB_RUN_ID || '').trim(),
  sections,
  missingRequired: Object.entries(sections)
    .filter(([, value]) => value.required && !value.present)
    .map(([key]) => key),
};

await fs.writeFile(outputPath, JSON.stringify(packet, null, 2), 'utf8');
console.log(`[go-no-go] packet written: ${outputPath}`);
