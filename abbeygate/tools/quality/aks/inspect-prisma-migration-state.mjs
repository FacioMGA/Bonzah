#!/usr/bin/env node
// MUST be imported before `pg`: patches `process.emitWarning` so the
// pg-connection-string SSL-mode deprecation no longer pollutes deploy logs.
import './_pgConnectionWarning.mjs';
import fs from 'node:fs';
import { Client } from 'pg';

const reportPath = String(process.env.PRISMA_STATE_REPORT_PATH || '/tmp/prisma-migration-state.json').trim();
const baselineMigration = String(process.env.PRISMA_BASELINE_MIGRATION || '20260402191703_baseline').trim();
const projectionMigration = '20260403113000_add_account_intelligence_projection';
const productMixMigration = '20260403181500_add_account_intelligence_product_mix';

function parseUrlDatabaseName(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    return decodeURIComponent(url.pathname.replace(/^\//, '').trim());
  } catch {
    return '';
  }
}

function appendOutput(name, value) {
  const outputPath = String(process.env.GITHUB_OUTPUT || '').trim();
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${name}=${String(value)}\n`, 'utf8');
}

function writeReport(report) {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function applyOutputs(report) {
  appendOutput('current_database', report.currentDatabase || '');
  appendOutput('url_database', report.urlDatabase || '');
  appendOutput('public_table_count', report.publicTableCount);
  appendOutput('prisma_migrations_table_exists', report.prismaMigrationsTableExists);
  appendOutput('prisma_history_count', report.prismaHistoryCount);
  appendOutput('issue_count', report.issues.length);
  appendOutput('baseline_already_applied', report.baselineAlreadyApplied);
  appendOutput('shape', report.shape);
  appendOutput('can_baseline', report.canBaseline);
  appendOutput('mark_projection_migration_applied', report.markProjectionMigrationApplied);
  appendOutput('mark_product_mix_migration_applied', report.markProductMixMigrationApplied);
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    const report = {
      checkedAt: new Date().toISOString(),
      currentDatabase: null,
      urlDatabase: null,
      publicTableCount: 0,
      prismaMigrationsTableExists: false,
      prismaHistoryCount: 0,
      baselineAlreadyApplied: false,
      accountProjectionTableExists: false,
      accountProjectionProductMixExists: false,
      shape: 'missing_database_url',
      canBaseline: false,
      markProjectionMigrationApplied: false,
      markProductMixMigrationApplied: false,
      issues: ['DATABASE_URL is required'],
    };
    writeReport(report);
    applyOutputs(report);
    console.error('[prisma-state] FAILED: DATABASE_URL is required');
    console.error(`[prisma-state] report written: ${reportPath}`);
    process.exit(1);
  }

  const report = {
    checkedAt: new Date().toISOString(),
    currentDatabase: null,
    urlDatabase: parseUrlDatabaseName(databaseUrl),
    publicTableCount: 0,
    samplePublicTables: [],
    prismaMigrationsTableExists: false,
    prismaHistoryCount: 0,
    appliedMigrations: [],
    baselineAlreadyApplied: false,
    accountProjectionTableExists: false,
    accountProjectionProductMixExists: false,
    shape: 'unknown',
    canBaseline: false,
    markProjectionMigrationApplied: false,
    markProductMixMigrationApplied: false,
    issues: [],
  };

  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const currentDbResult = await client.query('SELECT current_database() AS current_database');
    report.currentDatabase = String(currentDbResult.rows[0]?.current_database || '').trim() || null;

    const tableResult = await client.query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `,
    );
    const publicTables = tableResult.rows.map((row) => String(row.table_name));
    const appTables = publicTables.filter((tableName) => tableName !== '_prisma_migrations');
    report.publicTableCount = appTables.length;
    report.samplePublicTables = appTables.slice(0, 25);
    report.prismaMigrationsTableExists = publicTables.includes('_prisma_migrations');

    if (report.prismaMigrationsTableExists) {
      const historyResult = await client.query(
        'SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at NULLS LAST, migration_name',
      );
      report.appliedMigrations = historyResult.rows.map((row) => String(row.migration_name || '').trim()).filter(Boolean);
      report.prismaHistoryCount = report.appliedMigrations.length;
      report.baselineAlreadyApplied = report.appliedMigrations.includes(baselineMigration);
    }

    const accountProjectionTableResult = await client.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'account_intelligence_projection'
        ) AS present
      `,
    );
    report.accountProjectionTableExists = Boolean(accountProjectionTableResult.rows[0]?.present);

    const productMixColumnResult = await client.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'account_intelligence_projection'
            AND column_name = 'productMix'
        ) AS present
      `,
    );
    report.accountProjectionProductMixExists = Boolean(productMixColumnResult.rows[0]?.present);

    if (report.accountProjectionProductMixExists && !report.accountProjectionTableExists) {
      report.shape = 'unsupported_schema_state';
      report.issues.push('productMix column exists without account_intelligence_projection table');
    } else if (report.prismaHistoryCount > 0) {
      report.shape = 'database_has_prisma_history';
    } else if (report.publicTableCount === 0) {
      report.shape = 'empty_database';
    } else {
      report.shape = 'non_empty_without_prisma_history';
      report.canBaseline = true;
      report.markProjectionMigrationApplied = report.accountProjectionTableExists;
      report.markProductMixMigrationApplied = report.accountProjectionProductMixExists;
    }

    if (report.currentDatabase && report.urlDatabase && report.currentDatabase !== report.urlDatabase) {
      report.shape = 'unsupported_schema_state';
      report.canBaseline = false;
      report.markProjectionMigrationApplied = false;
      report.markProductMixMigrationApplied = false;
      report.issues.push(
        `DATABASE_URL targets '${report.urlDatabase}' but current_database() returned '${report.currentDatabase}'`,
      );
    }

    if (
      report.prismaHistoryCount > 0 &&
      report.accountProjectionProductMixExists &&
      !report.appliedMigrations.includes(productMixMigration)
    ) {
      report.issues.push(
        `${productMixMigration} schema detected without matching Prisma history entry; investigate drift before baselining`,
      );
    }

    if (
      report.prismaHistoryCount > 0 &&
      report.accountProjectionTableExists &&
      !report.appliedMigrations.includes(projectionMigration)
    ) {
      report.issues.push(
        `${projectionMigration} schema detected without matching Prisma history entry; investigate drift before baselining`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.shape = 'inspection_failed';
    report.issues.push(message);
    writeReport(report);
    applyOutputs(report);
    console.error(`[prisma-state] FAILED: ${message}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    console.error(`[prisma-state] report written: ${reportPath}`);
    process.exit(1);
  } finally {
    try {
      await client.end();
    } catch {
      // no-op
    }
  }

  writeReport(report);
  applyOutputs(report);
  console.log(`[prisma-state] report written: ${reportPath}`);
  console.log(
    `[prisma-state] shape=${report.shape} current_database=${report.currentDatabase || 'unknown'} public_tables=${report.publicTableCount} prisma_history=${report.prismaHistoryCount}`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const report = {
    checkedAt: new Date().toISOString(),
    currentDatabase: null,
    urlDatabase: null,
    publicTableCount: 0,
    prismaMigrationsTableExists: false,
    prismaHistoryCount: 0,
    baselineAlreadyApplied: false,
    accountProjectionTableExists: false,
    accountProjectionProductMixExists: false,
    shape: 'inspection_failed',
    canBaseline: false,
    markProjectionMigrationApplied: false,
    markProductMixMigrationApplied: false,
    issues: [message],
  };
  writeReport(report);
  applyOutputs(report);
  console.error(`[prisma-state] FAILED: ${message}`);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  console.error(`[prisma-state] report written: ${reportPath}`);
  process.exit(1);
});
