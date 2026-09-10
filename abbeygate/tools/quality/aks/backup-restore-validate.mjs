#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const sourceUrl = String(process.env.BACKUP_SOURCE_DATABASE_URL || '').trim();
const restoreUrl = String(process.env.BACKUP_RESTORE_DATABASE_URL || '').trim();
const outDir = String(process.env.BACKUP_ARTIFACT_DIR || '/tmp').trim();
const dumpFile = `${outDir}/prelaunch-backup.dump`;
const reportFile = String(process.env.BACKUP_VALIDATE_REPORT_PATH || `${outDir}/backup-restore-validation.json`).trim();
const dryRun = ['1', 'true', 'yes'].includes(String(process.env.BACKUP_VALIDATE_DRY_RUN || '').toLowerCase());
const restoreHealthcheckUrl = String(process.env.BACKUP_RESTORE_APP_HEALTHCHECK_URL || '').trim();
const restoreSmokeCommand = String(process.env.BACKUP_RESTORE_SMOKE_COMMAND || '').trim();
const startedAt = new Date().toISOString();

if (!dryRun && (!sourceUrl || !restoreUrl)) {
  throw new Error('Set BACKUP_SOURCE_DATABASE_URL and BACKUP_RESTORE_DATABASE_URL');
}
if (!fs.existsSync(outDir)) {
  throw new Error(`Artifact directory not found: ${outDir}`);
}

const report = {
  dryRun,
  sourceConfigured: Boolean(sourceUrl),
  restoreConfigured: Boolean(restoreUrl),
  dumpFile,
  startedAt,
  completedAt: null,
  steps: [],
  criticalTables: [],
  integrityChecks: [],
  optionalChecks: [],
  failures: [],
  summary: {
    schemaCompatible: false,
    dataParityOk: false,
    documentMetadataOk: false,
    appSmokeOk: restoreHealthcheckUrl ? false : null,
    restoreSmokeCommandOk: restoreSmokeCommand ? false : null,
  },
};

function addStep(name, status, details = {}) {
  report.steps.push({
    name,
    status,
    at: new Date().toISOString(),
    ...details,
  });
}

function sqlEscape(sql) {
  return sql.replace(/"/g, '\\"');
}

function runCommand(command, options = {}) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
  });
}

function runPsqlValue(databaseUrl, sql) {
  const output = runCommand(`psql "${databaseUrl}" -X -q -t -A -v ON_ERROR_STOP=1 -c "${sqlEscape(sql)}"`);
  return String(output || '').trim();
}

function readNumber(value) {
  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

function tableExists(databaseUrl, tableName) {
  return runPsqlValue(
    databaseUrl,
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = '${tableName}'
     );`,
  ) === 't';
}

function columnExists(databaseUrl, tableName, columnName) {
  return runPsqlValue(
    databaseUrl,
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = '${tableName}'
         AND column_name = '${columnName}'
     );`,
  ) === 't';
}

function readCount(databaseUrl, sql) {
  return readNumber(runPsqlValue(databaseUrl, sql));
}

function recordFailure(scope, message, details = {}) {
  report.failures.push({ scope, message, ...details });
}

async function runOptionalHealthcheck() {
  if (!restoreHealthcheckUrl) return;
  try {
    const response = await fetch(restoreHealthcheckUrl, { method: 'GET' });
    const body = await response.text();
    const ok = response.ok;
    report.optionalChecks.push({
      name: 'restore_app_healthcheck',
      ok,
      url: restoreHealthcheckUrl,
      status: response.status,
      bodyPreview: body.slice(0, 500),
    });
    report.summary.appSmokeOk = ok;
    if (!ok) {
      recordFailure('restore_app_healthcheck', `Healthcheck returned HTTP ${response.status}`, { url: restoreHealthcheckUrl });
    }
  } catch (error) {
    report.optionalChecks.push({
      name: 'restore_app_healthcheck',
      ok: false,
      url: restoreHealthcheckUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    report.summary.appSmokeOk = false;
    recordFailure('restore_app_healthcheck', 'Healthcheck request failed', {
      url: restoreHealthcheckUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function runOptionalSmokeCommand() {
  if (!restoreSmokeCommand) return;
  try {
    runCommand(restoreSmokeCommand, { stdio: 'inherit' });
    report.optionalChecks.push({
      name: 'restore_smoke_command',
      ok: true,
      command: restoreSmokeCommand,
    });
    report.summary.restoreSmokeCommandOk = true;
  } catch (error) {
    report.optionalChecks.push({
      name: 'restore_smoke_command',
      ok: false,
      command: restoreSmokeCommand,
      error: error instanceof Error ? error.message : String(error),
    });
    report.summary.restoreSmokeCommandOk = false;
    recordFailure('restore_smoke_command', 'Smoke command failed', {
      command: restoreSmokeCommand,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main() {
  try {
    console.log('[backup-restore] Creating backup artifact...');
    if (dryRun) {
      console.log('[backup-restore] DRY RUN: skipping pg_dump');
      addStep('pg_dump', 'skipped');
    } else {
      runCommand(`pg_dump "${sourceUrl}" -Fc -f "${dumpFile}"`, { stdio: 'inherit' });
      addStep('pg_dump', 'success', { dumpFile });
    }

    console.log('[backup-restore] Restoring into staging target...');
    if (dryRun) {
      console.log('[backup-restore] DRY RUN: skipping pg_restore');
      addStep('pg_restore', 'skipped');
    } else {
      runCommand(`pg_restore --clean --if-exists --no-owner --no-privileges -d "${restoreUrl}" "${dumpFile}"`, { stdio: 'inherit' });
      addStep('pg_restore', 'success');
    }

    console.log('[backup-restore] Running integrity probes...');
    if (dryRun) {
      console.log('[backup-restore] DRY RUN: skipping integrity probes');
      addStep('integrity_probes', 'skipped');
    } else {
      const sourceTableCount = readCount(sourceUrl, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';`);
      const restoreTableCount = readCount(restoreUrl, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';`);
      const sourceMigrationCount = tableExists(sourceUrl, '_prisma_migrations')
        ? readCount(sourceUrl, 'SELECT COUNT(*) FROM "_prisma_migrations";')
        : 0;
      const restoreMigrationCount = tableExists(restoreUrl, '_prisma_migrations')
        ? readCount(restoreUrl, 'SELECT COUNT(*) FROM "_prisma_migrations";')
        : 0;
      const schemaCompatible = sourceTableCount === restoreTableCount && sourceMigrationCount === restoreMigrationCount;
      report.integrityChecks.push({
        name: 'schema_shape',
        ok: schemaCompatible,
        sourceTableCount,
        restoreTableCount,
        sourceMigrationCount,
        restoreMigrationCount,
      });
      report.summary.schemaCompatible = schemaCompatible;
      if (!schemaCompatible) {
        recordFailure('schema_shape', 'Restored schema shape does not match source', {
          sourceTableCount,
          restoreTableCount,
          sourceMigrationCount,
          restoreMigrationCount,
        });
      }

      const criticalTables = ['users', 'accounts', 'policies', 'documents', 'risk_transactions', 'payments'];
      for (const tableName of criticalTables) {
        const sourceHasTable = tableExists(sourceUrl, tableName);
        const restoreHasTable = tableExists(restoreUrl, tableName);
        const sourceCount = sourceHasTable ? readCount(sourceUrl, `SELECT COUNT(*) FROM "${tableName}";`) : null;
        const restoreCount = restoreHasTable ? readCount(restoreUrl, `SELECT COUNT(*) FROM "${tableName}";`) : null;
        const ok = sourceHasTable === restoreHasTable && sourceCount === restoreCount;
        report.criticalTables.push({
          table: tableName,
          ok,
          sourceHasTable,
          restoreHasTable,
          sourceCount,
          restoreCount,
        });
        if (!ok) {
          recordFailure('critical_table_parity', `Critical table parity failed for ${tableName}`, {
            table: tableName,
            sourceHasTable,
            restoreHasTable,
            sourceCount,
            restoreCount,
          });
        }
      }

      const joinSupported =
        tableExists(sourceUrl, 'policies') &&
        tableExists(sourceUrl, 'accounts') &&
        columnExists(sourceUrl, 'policies', 'accountId') &&
        tableExists(restoreUrl, 'policies') &&
        tableExists(restoreUrl, 'accounts') &&
        columnExists(restoreUrl, 'policies', 'accountId');
      if (joinSupported) {
        const query = 'SELECT COUNT(*) FROM "policies" p INNER JOIN "accounts" a ON a.id = p."accountId";';
        const sourceJoinCount = readCount(sourceUrl, query);
        const restoreJoinCount = readCount(restoreUrl, query);
        const ok = sourceJoinCount === restoreJoinCount;
        report.integrityChecks.push({
          name: 'policy_account_join_parity',
          ok,
          sourceJoinCount,
          restoreJoinCount,
        });
        if (!ok) {
          recordFailure('policy_account_join_parity', 'Policy/account join count mismatch', {
            sourceJoinCount,
            restoreJoinCount,
          });
        }
      }

      const documentMetadataSupported =
        tableExists(sourceUrl, 'documents') &&
        tableExists(restoreUrl, 'documents') &&
        columnExists(sourceUrl, 'documents', 'storageUri') &&
        columnExists(sourceUrl, 'documents', 'filename') &&
        columnExists(restoreUrl, 'documents', 'storageUri') &&
        columnExists(restoreUrl, 'documents', 'filename');
      if (documentMetadataSupported) {
        const query = `
          SELECT
            COUNT(*) AS total_docs,
            COUNT(*) FILTER (WHERE COALESCE("storageUri", '') <> '') AS docs_with_storage_uri,
            COUNT(*) FILTER (WHERE COALESCE(filename, '') <> '') AS docs_with_filename
          FROM "documents";
        `;
        const sourceStatsRaw = runPsqlValue(sourceUrl, query).split('|');
        const restoreStatsRaw = runPsqlValue(restoreUrl, query).split('|');
        const sourceStats = {
          totalDocs: readNumber(sourceStatsRaw[0]),
          docsWithStorageUri: readNumber(sourceStatsRaw[1]),
          docsWithFilename: readNumber(sourceStatsRaw[2]),
        };
        const restoreStats = {
          totalDocs: readNumber(restoreStatsRaw[0]),
          docsWithStorageUri: readNumber(restoreStatsRaw[1]),
          docsWithFilename: readNumber(restoreStatsRaw[2]),
        };
        const ok =
          sourceStats.totalDocs === restoreStats.totalDocs &&
          sourceStats.docsWithStorageUri === restoreStats.docsWithStorageUri &&
          sourceStats.docsWithFilename === restoreStats.docsWithFilename;
        report.integrityChecks.push({
          name: 'document_metadata_parity',
          ok,
          source: sourceStats,
          restore: restoreStats,
        });
        report.summary.documentMetadataOk = ok;
        if (!ok) {
          recordFailure('document_metadata_parity', 'Document metadata counts do not match source', {
            source: sourceStats,
            restore: restoreStats,
          });
        }
      } else {
        report.summary.documentMetadataOk = false;
        report.optionalChecks.push({
          name: 'document_metadata_parity',
          ok: false,
          skipped: true,
          reason: 'documents table or required columns missing on source or restore database',
        });
        recordFailure('document_metadata_parity', 'Document metadata parity check could not run because the required schema was unavailable.');
      }

      report.summary.dataParityOk =
        report.criticalTables.every((entry) => entry.ok) &&
        report.integrityChecks.every((entry) => entry.ok) &&
        report.summary.documentMetadataOk === true;

      await runOptionalHealthcheck();
      runOptionalSmokeCommand();
      addStep('integrity_probes', report.failures.length === 0 ? 'success' : 'failure');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordFailure('execution', message);
    addStep('execution', 'failure', { error: message });
  } finally {
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[backup-restore] Report written: ${reportFile}`);
  }

  if (report.failures.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(`[backup-restore] Validation complete. Artifact: ${dumpFile}`);
}

await main();
