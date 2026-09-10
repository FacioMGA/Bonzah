#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const reportPath = String(process.env.BACKUP_POSTURE_REPORT_PATH || '/tmp/backup-posture.json').trim();
const resourceGroup = String(process.env.AKS_RESOURCE_GROUP || process.env.RESOURCE_GROUP || '').trim();
const postgresServerName = String(process.env.AKS_POSTGRES_SERVER_NAME || process.env.POSTGRES_SERVER_NAME || '').trim();
const storageAccountName = String(process.env.AKS_STORAGE_ACCOUNT_NAME || process.env.STORAGE_ACCOUNT_NAME || '').trim();
const keyVaultName = String(process.env.AKS_KEYVAULT_NAME || process.env.KEYVAULT_NAME || '').trim();
const redisName = String(process.env.AKS_REDIS_NAME || process.env.REDIS_NAME || '').trim();
const redisRecoveryMode = String(process.env.REDIS_RECOVERY_MODE || 'disposable').trim().toLowerCase();
const redisEvidence = String(process.env.REDIS_PERSISTENCE_EVIDENCE || '').trim();
const lastRestoreValidatedAt = String(process.env.BACKUP_POLICY_LAST_RESTORE_VALIDATED_AT || '').trim();
const allowFreshEnvironmentRestoreWaiver = ['1', 'true', 'yes'].includes(
  String(process.env.ALLOW_FRESH_ENV_RESTORE_VALIDATION_WAIVER || '').toLowerCase(),
);

const minPostgresRetentionDays = Number(process.env.MIN_POSTGRES_BACKUP_RETENTION_DAYS || 35);
const minBlobDeleteRetentionDays = Number(process.env.MIN_BLOB_DELETE_RETENTION_DAYS || 30);
const minBlobContainerDeleteRetentionDays = Number(process.env.MIN_BLOB_CONTAINER_DELETE_RETENTION_DAYS || 30);
const maxRestoreValidationAgeDays = Number(process.env.MAX_RESTORE_VALIDATION_AGE_DAYS || 30);
const requirePostgresGeoRedundantBackup = ['1', 'true', 'yes'].includes(String(process.env.REQUIRE_POSTGRES_GEO_REDUNDANT_BACKUP || '').toLowerCase());
const requireBlobVersioning = !['0', 'false', 'no'].includes(String(process.env.REQUIRE_BLOB_VERSIONING || 'true').toLowerCase());
const requireBlobChangeFeed = !['0', 'false', 'no'].includes(String(process.env.REQUIRE_BLOB_CHANGE_FEED || 'true').toLowerCase());
const requireKeyVaultPurgeProtection = !['0', 'false', 'no'].includes(String(process.env.REQUIRE_KEYVAULT_PURGE_PROTECTION || 'true').toLowerCase());

const report = {
  checkedAt: new Date().toISOString(),
  resourceGroup,
  contract: {
    minPostgresRetentionDays,
    minBlobDeleteRetentionDays,
    minBlobContainerDeleteRetentionDays,
    maxRestoreValidationAgeDays,
    requirePostgresGeoRedundantBackup,
    requireBlobVersioning,
    requireBlobChangeFeed,
    requireKeyVaultPurgeProtection,
    redisRecoveryMode,
  },
  controls: [],
  failures: [],
};

const CONTROL_ENV_HINTS = {
  resource_group_configured: ['AKS_RESOURCE_GROUP', 'RESOURCE_GROUP'],
  postgres_server_configured: ['AKS_POSTGRES_SERVER_NAME', 'POSTGRES_SERVER_NAME'],
  storage_account_configured: ['AKS_STORAGE_ACCOUNT_NAME', 'STORAGE_ACCOUNT_NAME'],
  key_vault_configured: ['AKS_KEYVAULT_NAME', 'KEYVAULT_NAME'],
  recent_restore_validation: ['BACKUP_POLICY_LAST_RESTORE_VALIDATED_AT'],
  redis_recovery_policy: ['REDIS_RECOVERY_MODE', 'AKS_REDIS_NAME', 'REDIS_PERSISTENCE_EVIDENCE'],
};

function parseJsonCommand(command) {
  const stdout = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
  return JSON.parse(stdout);
}

function readBoolean(value) {
  return value === true || value === 'true' || value === 'Enabled' || value === 'enabled';
}

function addControl(name, ok, details = {}) {
  report.controls.push({ name, ok, ...details });
  if (!ok) {
    report.failures.push({ name, ...details });
  }
}

function requireValue(name, value) {
  if (!value) {
    addControl(name, false, { reason: 'missing_required_configuration' });
    return false;
  }
  return true;
}

function daysSince(isoValue) {
  const ts = Date.parse(isoValue);
  if (!Number.isFinite(ts)) return Number.NaN;
  return (Date.now() - ts) / (1000 * 60 * 60 * 24);
}

try {
  const hasResourceGroup = requireValue('resource_group_configured', resourceGroup);

  if (requireValue('postgres_server_configured', postgresServerName) && hasResourceGroup) {
    const postgres = parseJsonCommand(
      `az postgres flexible-server show --resource-group "${resourceGroup}" --name "${postgresServerName}" -o json`,
    );
    const backupRetentionDays =
      Number(postgres?.backup?.backupRetentionDays ?? postgres?.backupRetentionDays ?? Number.NaN);
    const geoRedundantBackup = String(postgres?.backup?.geoRedundantBackup ?? postgres?.geoRedundantBackup ?? '').trim();
    addControl('postgres_backup_retention', Number.isFinite(backupRetentionDays) && backupRetentionDays >= minPostgresRetentionDays, {
      postgresServerName,
      backupRetentionDays,
      requiredMinRetentionDays: minPostgresRetentionDays,
    });
    addControl('postgres_geo_redundant_backup', !requirePostgresGeoRedundantBackup || geoRedundantBackup === 'Enabled', {
      postgresServerName,
      geoRedundantBackup,
      required: requirePostgresGeoRedundantBackup,
    });
  }

  if (requireValue('storage_account_configured', storageAccountName) && hasResourceGroup) {
    const blobProps = parseJsonCommand(
      `az storage account blob-service-properties show --account-name "${storageAccountName}" --resource-group "${resourceGroup}" -o json`,
    );
    const blobDeleteRetentionEnabled = readBoolean(blobProps?.deleteRetentionPolicy?.enabled);
    const blobDeleteRetentionDays = Number(blobProps?.deleteRetentionPolicy?.days ?? Number.NaN);
    const containerDeleteRetentionEnabled = readBoolean(blobProps?.containerDeleteRetentionPolicy?.enabled);
    const containerDeleteRetentionDays = Number(blobProps?.containerDeleteRetentionPolicy?.days ?? Number.NaN);
    const versioningEnabled = readBoolean(blobProps?.isVersioningEnabled);
    const changeFeedEnabled = readBoolean(blobProps?.changeFeed?.enabled);

    addControl('blob_delete_retention', blobDeleteRetentionEnabled && blobDeleteRetentionDays >= minBlobDeleteRetentionDays, {
      storageAccountName,
      blobDeleteRetentionEnabled,
      blobDeleteRetentionDays,
      requiredMinRetentionDays: minBlobDeleteRetentionDays,
    });
    addControl(
      'blob_container_delete_retention',
      containerDeleteRetentionEnabled && containerDeleteRetentionDays >= minBlobContainerDeleteRetentionDays,
      {
        storageAccountName,
        containerDeleteRetentionEnabled,
        containerDeleteRetentionDays,
        requiredMinRetentionDays: minBlobContainerDeleteRetentionDays,
      },
    );
    addControl('blob_versioning', !requireBlobVersioning || versioningEnabled, {
      storageAccountName,
      versioningEnabled,
      required: requireBlobVersioning,
    });
    addControl('blob_change_feed', !requireBlobChangeFeed || changeFeedEnabled, {
      storageAccountName,
      changeFeedEnabled,
      required: requireBlobChangeFeed,
    });
  }

  if (requireValue('key_vault_configured', keyVaultName) && hasResourceGroup) {
    const keyVault = parseJsonCommand(`az keyvault show --resource-group "${resourceGroup}" --name "${keyVaultName}" -o json`);
    const softDeleteEnabled = readBoolean(keyVault?.properties?.enableSoftDelete ?? keyVault?.properties?.softDeleteRetentionInDays !== undefined);
    const purgeProtectionEnabled = readBoolean(keyVault?.properties?.enablePurgeProtection);
    const softDeleteRetentionInDays = Number(keyVault?.properties?.softDeleteRetentionInDays ?? Number.NaN);

    addControl('key_vault_soft_delete', softDeleteEnabled, {
      keyVaultName,
      softDeleteEnabled,
      softDeleteRetentionInDays,
    });
    addControl('key_vault_purge_protection', !requireKeyVaultPurgeProtection || purgeProtectionEnabled, {
      keyVaultName,
      purgeProtectionEnabled,
      required: requireKeyVaultPurgeProtection,
    });
  }

  if (redisRecoveryMode === 'disposable') {
    addControl('redis_recovery_policy', true, {
      redisName: redisName || null,
      mode: redisRecoveryMode,
      reason: 'Redis is treated as rebuildable queue/cache state; durable business records stay in Postgres/Blob.',
    });
  } else {
    addControl('redis_recovery_policy', Boolean(redisEvidence), {
      redisName: redisName || null,
      mode: redisRecoveryMode,
      redisEvidence: redisEvidence || null,
      reason: 'Persistent Redis mode requires an evidence reference or documented recovery mechanism.',
    });
  }

  const ageDays = lastRestoreValidatedAt ? daysSince(lastRestoreValidatedAt) : Number.NaN;
  if (allowFreshEnvironmentRestoreWaiver) {
    addControl('recent_restore_validation', true, {
      lastRestoreValidatedAt: lastRestoreValidatedAt || null,
      ageDays: Number.isFinite(ageDays) ? Number(ageDays.toFixed(2)) : null,
      maxAgeDays: maxRestoreValidationAgeDays,
      waiver: 'fresh_environment_restore_validation_deferred',
      reason: 'Fresh environment deploy approved without requiring a restore-validation drill before first migration run.',
    });
  } else {
    addControl('recent_restore_validation', Number.isFinite(ageDays) && ageDays <= maxRestoreValidationAgeDays, {
      lastRestoreValidatedAt: lastRestoreValidatedAt || null,
      ageDays: Number.isFinite(ageDays) ? Number(ageDays.toFixed(2)) : null,
      maxAgeDays: maxRestoreValidationAgeDays,
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  addControl('backup_posture_execution', false, { error: message });
}

fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`[backup-posture] report written: ${reportPath}`);

if (report.failures.length > 0) {
  console.error(`[backup-posture] FAILED: ${report.failures.length} control(s) did not meet policy.`);
  console.error('[backup-posture] For the production deploy workflow, configure non-secret values as GitHub Actions environment variables on the `production-aks` environment.');
  for (const failure of report.failures) {
    const reason = failure.reason || failure.error || 'policy_violation';
    const hints = CONTROL_ENV_HINTS[failure.name] || [];
    console.error(` - ${failure.name}: ${reason}`);
    if (hints.length > 0) {
      console.error(`   expected configuration: ${hints.join(', ')}`);
    }
    if (failure.name === 'recent_restore_validation') {
      console.error('   expected value: ISO-8601 timestamp of the most recent successful restore validation.');
    }
  }
  process.exitCode = 1;
}
