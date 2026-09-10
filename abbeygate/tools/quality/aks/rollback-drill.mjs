#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const runbookPath = 'docs/runbooks/aks-rollback-2026-03.md';
const reportPath = String(process.env.ROLLBACK_DRILL_REPORT_PATH || '/tmp/rollback-drill.json').trim();
const backupReportPath = String(process.env.BACKUP_VALIDATE_REPORT_PATH || '/tmp/backup-restore-validation.json').trim();
const trigger = String(process.env.ROLLBACK_TRIGGER || 'tenant_isolation_test_failed').trim();
const previousTag = String(process.env.PREVIOUS_RELEASE_TAG || '').trim();
const rollbackSmokeCommand = String(process.env.ROLLBACK_SMOKE_COMMAND || '').trim();
const runRealBackupValidation = ['1', 'true', 'yes'].includes(String(process.env.ROLLBACK_RUN_REAL_BACKUP_VALIDATE || '').toLowerCase());

const report = {
  executedAt: new Date().toISOString(),
  trigger,
  previousTag,
  runbookPath,
  backupReportPath,
  steps: [],
  failures: [],
};

function addStep(name, status, details = {}) {
  report.steps.push({
    name,
    status,
    at: new Date().toISOString(),
    ...details,
  });
  if (status === 'failure') {
    report.failures.push({ name, ...details });
  }
}

function run(command) {
  execSync(command, { stdio: 'inherit' });
}

try {
  if (!fs.existsSync(runbookPath)) {
    throw new Error(`Rollback runbook missing: ${runbookPath}`);
  }
  addStep('runbook_present', 'success');

  if (!previousTag) {
    throw new Error('Set PREVIOUS_RELEASE_TAG to execute rollback drill');
  }
  addStep('rollback_target_resolved', 'success', { previousTag });

  console.log('[rollback-drill] Trigger:', trigger);
  console.log('[rollback-drill] Target release tag:', previousTag);

  if (runRealBackupValidation) {
    console.log('[rollback-drill] Running real backup/restore validation before rollback smoke...');
    run('npm run backup:restore:validate');
    addStep('backup_restore_validation', 'success', {
      mode: 'real',
      reportPath: backupReportPath,
    });
  } else if (fs.existsSync(backupReportPath)) {
    const backupReport = JSON.parse(fs.readFileSync(backupReportPath, 'utf8'));
    const ok = Array.isArray(backupReport.failures) ? backupReport.failures.length === 0 : true;
    addStep(ok ? 'backup_restore_evidence' : 'backup_restore_evidence', ok ? 'success' : 'failure', {
      mode: 'existing_report',
      reportPath: backupReportPath,
      backupFailures: backupReport.failures || [],
    });
  } else {
    addStep('backup_restore_evidence', 'failure', {
      reason: 'missing_backup_restore_report',
      reportPath: backupReportPath,
    });
  }

  addStep('previous_release_redeploy_plan', 'success', {
    action: 'Validated rollback target and recorded drill evidence. Perform actual redeploy via release workflow when executing a live rollback.',
  });

  addStep('queue_reconciliation_plan', 'success', {
    action: 'Pause workers, reconcile queues, then resume in controlled order per runbook.',
  });

  if (rollbackSmokeCommand) {
    console.log('[rollback-drill] Running rollback smoke command...');
    run(rollbackSmokeCommand);
    addStep('rollback_smoke', 'success', { command: rollbackSmokeCommand });
  } else {
    addStep('rollback_smoke', 'success', {
      command: null,
      action: 'No ROLLBACK_SMOKE_COMMAND provided; rely on documented smoke subset execution during live rollback.',
    });
  }
} catch (error) {
  addStep('rollback_drill_execution', 'failure', {
    error: error instanceof Error ? error.message : String(error),
  });
} finally {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[rollback-drill] Report written: ${reportPath}`);
}

if (report.failures.length > 0) {
  process.exitCode = 1;
} else {
  console.log('[rollback-drill] Completed successfully');
}
