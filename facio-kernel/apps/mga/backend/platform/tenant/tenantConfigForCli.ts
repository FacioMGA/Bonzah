/** Explicit non-HTTP tenant bootstrap. No default customer identity, country, taxes or sender. */
import { readFileSync } from 'node:fs';
import type { TenantConfig } from './tenantConfig.js';
import { parseTenantConfig } from './tenantConfigProjection.js';
import { TenantConfigurationIncompleteError } from './tenantRuntimeSettings.js';

export function buildTenantConfigFromEnv(): TenantConfig {
  const inline = process.env.KERNEL_TENANT_CONFIG_JSON;
  const file = process.env.KERNEL_TENANT_CONFIG_FILE;
  if ((!inline && !file) || (inline && file))
    throw new TenantConfigurationIncompleteError('set exactly one of KERNEL_TENANT_CONFIG_JSON or KERNEL_TENANT_CONFIG_FILE');
  let raw: unknown;
  try { raw = JSON.parse(inline || readFileSync(file!, 'utf8')); }
  catch { throw new TenantConfigurationIncompleteError('explicit CLI tenant JSON could not be read'); }
  return parseTenantConfig(raw);
}
