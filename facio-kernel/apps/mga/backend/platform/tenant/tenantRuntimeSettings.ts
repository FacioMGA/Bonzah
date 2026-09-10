import { z } from 'zod';

const text = z.string().trim().min(1).max(500);
const email = z.email().max(254);
const webUrl = z.url().refine((value) => /^https?:\/\//.test(value), 'Use an HTTP or HTTPS URL');
const emails = z.array(email).max(50).refine((values) => new Set(values.map((value) => value.toLowerCase())).size === values.length, 'Duplicate recipient');

/** Tenant-owned content only. No country, host, customer or vendor defaults are inferred. */
export const tenantRuntimeSettingsSchema = z.object({
  schemaVersion: z.literal('tenant-runtime-v1'),
  locale: z.string().trim().min(2).max(40).refine((value) => { try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; } }, 'Use a valid locale'),
  timeZone: z.string().trim().min(1).max(100).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Use an IANA time zone'),
  organization: z.object({ declaredRole: z.enum(['MGA', 'BROKER', 'COVERHOLDER']) }).strict(),
  contact: z.object({ email, phone: text }).strict(),
  routing: z.object({
    underwritingReferralTo: emails.min(1),
    underwritingReferralCc: emails,
    onlinePolicyConfirmationCopies: emails,
  }).strict(),
  branding: z.object({
    displayName: text,
    primaryColor: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(),
    secondaryColor: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(),
    legalName: text,
    addressLines: z.array(text).min(1).max(12),
    legalLines: z.array(text).min(1).max(12),
    regulatorLine: text.nullable(),
    websiteUrl: webUrl.nullable(),
    websiteLabel: text.nullable(),
  }).strict(),
}).strict();

export type TenantRuntimeSettings = z.infer<typeof tenantRuntimeSettingsSchema>;

export class TenantConfigurationIncompleteError extends Error {
  readonly code = 'TENANT_CONFIGURATION_INCOMPLETE';
  constructor(field: string) {
    super(`Operating tenant configuration is incomplete: ${field}`);
    this.name = 'TenantConfigurationIncompleteError';
  }
}

export function parseTenantRuntimeSettings(raw: unknown): TenantRuntimeSettings {
  const parsed = tenantRuntimeSettingsSchema.safeParse(raw);
  if (!parsed.success) throw new TenantConfigurationIncompleteError(
    parsed.error.issues.map((issue) => issue.path.join('.')).join(', ') || 'runtimeSettings',
  );
  return parsed.data;
}
