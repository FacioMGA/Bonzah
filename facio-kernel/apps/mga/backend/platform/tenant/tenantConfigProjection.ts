import { z } from 'zod';
import type { TenantConfig } from './tenantConfig.js';
import { tenantRuntimeSettingsSchema, TenantConfigurationIncompleteError } from './tenantRuntimeSettings.js';

const webUrl = z.url().refine((value) => /^https?:\/\//.test(value), 'Use an HTTP or HTTPS URL');
const optionalLogo = z.union([z.literal(''), webUrl]);
export const tenantConfigSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['PRODUCTION', 'SYNTHETIC', 'TEST']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
  parentOrganizationId: z.uuid().optional(),
  tenantSlug: z.string().regex(/^[a-z][a-z0-9-]{1,99}$/),
  countryCode: z.enum(['CY', 'PT', 'GR', 'ES', 'IT', 'US']),
  country: z.string().trim().min(1).max(120),
  currency: z.string().regex(/^[A-Z]{3}$/),
  ipt: z.object({ rate: z.number().finite().min(0).max(1).optional(), flatFee: z.number().finite().min(0).optional() }).strict(),
  adminFee: z.number().finite().min(0),
  publicBaseUrl: webUrl,
  fromEmail: z.email(),
  brandLogo: z.object({ white: optionalLogo, blue: optionalLogo }).strict(),
  legalPack: z.enum(['cy', 'pt', 'gr', 'es', 'it', 'us']),
  defaultBrokerName: z.string().trim().min(1).max(200).optional(),
  runtimeSettings: tenantRuntimeSettingsSchema.optional(),
}).strict();

export function parseTenantConfig(raw: unknown): TenantConfig {
  const parsed = tenantConfigSchema.safeParse(raw);
  if (!parsed.success) throw new TenantConfigurationIncompleteError(parsed.error.issues.map((issue) => issue.path.join('.')).join(', '));
  return parsed.data;
}

export interface TenantConfigurationRow {
  kind?: string; status?: string; parentOrganizationId?: string | null;
  id: string; tenantSlug: string; countryCode: string; country: string; currency: string;
  iptJson: unknown; adminFee: unknown; legalPack: string; publicBaseUrl: string; fromEmail: string;
  brandLogos: unknown; defaultBrokerName: string | null; runtimeSettings?: unknown;
}

/** Shared HTTP/worker projector: identity and content come only from this exact database row. */
export function tenantRowToConfig(row: TenantConfigurationRow): TenantConfig {
  return parseTenantConfig({
    ...(row.kind ? { kind: row.kind } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.parentOrganizationId ? { parentOrganizationId: row.parentOrganizationId } : {}),
    id: row.id, tenantSlug: row.tenantSlug, countryCode: row.countryCode, country: row.country,
    currency: row.currency, ipt: row.iptJson, adminFee: Number(row.adminFee), legalPack: row.legalPack,
    publicBaseUrl: row.publicBaseUrl, fromEmail: row.fromEmail,
    brandLogo: row.brandLogos ?? { white: '', blue: '' },
    ...(row.defaultBrokerName ? { defaultBrokerName: row.defaultBrokerName } : {}),
    ...(row.runtimeSettings == null ? {} : { runtimeSettings: row.runtimeSettings }),
  });
}
