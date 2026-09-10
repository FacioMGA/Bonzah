#!/usr/bin/env node
// MUST be imported before `pg`: patches `process.emitWarning` so the
// pg-connection-string SSL-mode deprecation no longer pollutes deploy logs.
import './_pgConnectionWarning.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { Client } from 'pg';

const reportPath = String(process.env.DB_CONTRACT_REPORT_PATH || '/tmp/runtime-db-contract.json').trim();
const namespace = String(process.env.AKS_NAMESPACE || '').trim();
const runtimeSecretName = String(
  process.env.AKS_RUNTIME_SECRET_NAME ||
  process.env.RUNTIME_SECRET_NAME ||
  '',
).trim();

const requiredTables = [
  'event_processing_log',
];

const requiredColumns = [
  { table: 'communication_messages', column: 'communicationType' },
  { table: 'communication_messages', column: 'idempotencyKey' },
  { table: 'outbox', column: 'eventId' },
  { table: 'outbox', column: 'idempotencyKey' },
];

function readSecretKey(secretName, key) {
  if (!secretName || !namespace) return '';
  const encoded = execFileSync(
    'kubectl',
    [
      'get',
      'secret',
      secretName,
      '-n',
      namespace,
      '-o',
      `jsonpath={.data.${key}}`,
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  ).trim();
  if (!encoded) return '';
  return Buffer.from(encoded, 'base64').toString('utf8').trim();
}

function addFailure(report, name, details) {
  report.failures.push({ name, ...details });
}

async function main() {
  const report = {
    checkedAt: new Date().toISOString(),
    namespace: namespace || null,
    runtimeSecretName: runtimeSecretName || null,
    requiredTables,
    requiredColumns,
    databaseHost: null,
    tables: [],
    columns: [],
    failures: [],
  };

  const databaseUrl = String(process.env.DATABASE_URL || readSecretKey(runtimeSecretName, 'DATABASE_URL')).trim();
  if (!databaseUrl) {
    addFailure(report, 'database_url_available', {
      reason: 'missing_DATABASE_URL',
      expectedConfiguration: ['DATABASE_URL', 'AKS_RUNTIME_SECRET_NAME + k8s secret DATABASE_URL'],
    });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.error(`[db-contract] FAILED: report written ${reportPath}`);
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    report.databaseHost = client.host || null;

    const tableRows = await client.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name
      `,
      [requiredTables],
    );
    const presentTables = new Set(tableRows.rows.map((row) => String(row.table_name)));
    report.tables = requiredTables.map((tableName) => ({
      tableName,
      present: presentTables.has(tableName),
    }));

    for (const tableName of requiredTables) {
      if (!presentTables.has(tableName)) {
        addFailure(report, 'missing_table', { tableName });
      }
    }

    const columnTables = [...new Set(requiredColumns.map((item) => item.table))];
    const columnRows = await client.query(
      `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name, column_name
      `,
      [columnTables],
    );
    const presentColumns = new Set(
      columnRows.rows.map((row) => `${String(row.table_name)}.${String(row.column_name)}`),
    );
    report.columns = requiredColumns.map((item) => ({
      tableName: item.table,
      columnName: item.column,
      present: presentColumns.has(`${item.table}.${item.column}`),
    }));

    for (const item of requiredColumns) {
      if (!presentColumns.has(`${item.table}.${item.column}`)) {
        addFailure(report, 'missing_column', {
          tableName: item.table,
          columnName: item.column,
        });
      }
    }
  } catch (error) {
    addFailure(report, 'db_contract_execution', {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try {
      await client.end();
    } catch {
      // no-op
    }
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[db-contract] report written: ${reportPath}`);

  if (report.failures.length > 0) {
    console.error(`[db-contract] FAILED: ${report.failures.length} contract violation(s).`);
    for (const failure of report.failures) {
      if (failure.name === 'missing_table') {
        console.error(` - missing table: ${failure.tableName}`);
      } else if (failure.name === 'missing_column') {
        console.error(` - missing column: ${failure.tableName}.${failure.columnName}`);
      } else {
        console.error(` - ${failure.name}: ${failure.reason || 'unknown_error'}`);
      }
    }
    process.exit(1);
  }
}

main().catch((error) => {
  const report = {
    checkedAt: new Date().toISOString(),
    namespace: namespace || null,
    runtimeSecretName: runtimeSecretName || null,
    requiredTables,
    requiredColumns,
    failures: [
      {
        name: 'db_contract_execution',
        reason: error instanceof Error ? error.message : String(error),
      },
    ],
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.error(`[db-contract] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
