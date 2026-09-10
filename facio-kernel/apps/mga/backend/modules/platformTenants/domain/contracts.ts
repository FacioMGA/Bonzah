import { z } from 'zod';

const id = z.string().uuid();
const text = z.string().trim().min(1).max(160);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const imageUrl = z.string().url().max(2048).refine((value) => value.startsWith('https://'), 'HTTPS image URL required');

export const platformTenantProfileSchema = z.object({
  displayName: text,
  legalName: text,
  locale: z.string().min(2).max(35).refine((value) => { try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; } }, 'Valid BCP47 locale required'),
  timeZone: z.string().min(1).max(100).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Valid IANA time zone required'),
  addressLines: z.array(z.string().trim().min(1).max(200)).min(1).max(12),
  declaredRole: z.enum(['MGA', 'BROKER', 'COVERHOLDER']),
  contactEmail: z.string().email().max(254),
  contactPhone: z.string().trim().min(1).max(80),
  brandLogos: z.object({ white: imageUrl, blue: imageUrl }).strict().optional(),
  primaryColor: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional(),
}).strict();
export type PlatformTenantProfile = z.infer<typeof platformTenantProfileSchema>;

export const provisionPlatformTenantSchema = z.object({
  organizationId: id,
  templateId: z.string().min(1).max(100),
  templateVersion: z.number().int().positive(),
  templateHash: hash,
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  tenantSlug: z.string().min(3).max(63).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  profile: platformTenantProfileSchema,
  idempotencyKey: id,
}).strict();
export type ProvisionPlatformTenantInput = z.infer<typeof provisionPlatformTenantSchema>;

export const platformTenantMembershipSchema = z.object({
  tenantId: id,
  userId: id,
  role: z.enum(['ADMIN', 'UNDERWRITER']),
  active: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: id,
}).strict();
export type PlatformTenantMembershipInput = z.infer<typeof platformTenantMembershipSchema>;
export type PlatformActor = { userId: string; correlationId: string };
export type PlatformTenantRole = 'ADMIN' | 'UNDERWRITER';
export type PlatformOrganizationRole = 'OWNER' | 'ADMIN' | 'BUILDER';
export type PlatformOrganizationView = { id: string; slug: string; name: string; role: PlatformOrganizationRole };
export type PlatformTemplateView = {
  id: string; version: number; hash: string; name: string;
  jurisdiction: string; currency: string; productCodes: string[];
  kind: 'SYNTHETIC'; sourceCommit: string; limitations: string[];
};
export type PlatformTenantView = {
  id: string; organizationId: string; tenantSlug: string;
  kind: 'SYNTHETIC'; status: string; role: PlatformTenantRole;
  accountId: string; version: number; profile: PlatformTenantProfile;
};
export type PlatformTenantAccess = PlatformTenantView & { userId: string; membershipVersion: number };
export type PlatformProvisioningResult = {
  tenant: PlatformTenantView;
  template: { id: string; version: number; hash: string };
  programs: Array<{ id: string; productCode: string; name: string; status: string; binderId: string }>;
  requestHash: string; receiptHash: string;
};

export class PlatformTenantError extends Error {
  constructor(readonly code: string, message: string, readonly status = 403) {
    super(message);
    this.name = 'PlatformTenantError';
  }
}

export const platformPageSchema = z.object({ cursor: id.optional(), take: z.coerce.number().int().min(1).max(100).default(50), search: z.string().trim().min(1).max(160).optional() }).strict();
export type PlatformPageInput = { cursor?: string; take?: number; search?: string };
