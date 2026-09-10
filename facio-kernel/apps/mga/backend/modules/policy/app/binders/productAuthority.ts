import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { getTenantConfig } from '../../../../platform/tenant/tenantConfig.js';

export const BinderProductAuthorityCreateSchema = z.object({
  binderId: z.string().uuid(),
  productCode: z.string().trim().min(1).max(64).transform((value) => value.toUpperCase()),
  classOfBusiness: z.string().trim().min(1).max(64),
  riskCode: z.string().trim().max(16).nullable().optional(),
  territorialScope: z.array(z.string().trim().length(2).transform((value) => value.toUpperCase())).max(250).optional(),
  maxPremiumAnnual: z.number().nonnegative().nullable().optional(),
  maxPolicyPeriodDays: z.number().int().positive().nullable().optional(),
  maxAdvanceInceptionDays: z.number().int().nonnegative().nullable().optional(),
  authorityClasses: z.array(z.string().trim().min(1).max(64)).max(250).optional(),
  effectiveFrom: z.string().datetime().nullable().optional(),
  effectiveTo: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
}).strict();

export const BinderProductAuthorityUpdateSchema = BinderProductAuthorityCreateSchema.partial({
  classOfBusiness: true,
  riskCode: true,
  territorialScope: true,
  maxPremiumAnnual: true,
  maxPolicyPeriodDays: true,
  maxAdvanceInceptionDays: true,
  authorityClasses: true,
  effectiveFrom: true,
  effectiveTo: true,
  notes: true,
  status: true,
});

export type BinderProductAuthorityCreateInput = z.infer<typeof BinderProductAuthorityCreateSchema>;
export type BinderProductAuthorityUpdateInput = z.infer<typeof BinderProductAuthorityUpdateSchema>;

export class BinderProductAuthorityError extends Error {
  constructor(
    readonly code:
      | 'BINDER_NOT_FOUND'
      | 'PRODUCT_NOT_FOUND'
      | 'INVALID_DATE_RANGE'
      | 'BINDER_NOT_ACTIVE'
      | 'AUTHORITY_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'BinderProductAuthorityError';
  }
}

type AuthorityRecord = {
  id: string;
  binderId: string;
  productCode: string;
  classOfBusiness: string;
  riskCode: string | null;
  territorialScope: string[];
  maxPremiumAnnual: Prisma.Decimal | number | null;
  maxPolicyPeriodDays: number | null;
  maxAdvanceInceptionDays: number | null;
  authorityClasses: string[];
  status: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BinderProductAuthorityView = {
  id: string;
  binderId: string;
  productCode: string;
  classOfBusiness: string;
  riskCode: string | null;
  territorialScope: string[];
  maxPremiumAnnual: number | null;
  maxPolicyPeriodDays: number | null;
  maxAdvanceInceptionDays: number | null;
  authorityClasses: string[];
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

function view(row: AuthorityRecord): BinderProductAuthorityView {
  return {
    id: row.id,
    binderId: row.binderId,
    productCode: row.productCode,
    classOfBusiness: row.classOfBusiness,
    riskCode: row.riskCode,
    territorialScope: [...row.territorialScope],
    maxPremiumAnnual: row.maxPremiumAnnual === null ? null : Number(row.maxPremiumAnnual),
    maxPolicyPeriodDays: row.maxPolicyPeriodDays,
    maxAdvanceInceptionDays: row.maxAdvanceInceptionDays,
    authorityClasses: [...row.authorityClasses],
    status: row.status,
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertDateRange(effectiveFrom?: string | null, effectiveTo?: string | null): void {
  if (!effectiveFrom || !effectiveTo) return;
  if (new Date(effectiveFrom).getTime() > new Date(effectiveTo).getTime()) {
    throw new BinderProductAuthorityError('INVALID_DATE_RANGE', 'effectiveFrom must be on or before effectiveTo.');
  }
}

async function assertReferences(input: BinderProductAuthorityCreateInput): Promise<void> {
  const tenantId = getTenantConfig().id;
  const [binder, product] = await Promise.all([
    tenantScopedPrisma.binder.findFirst({
      where: { id: input.binderId, operatingTenantId: tenantId },
      select: { id: true, status: true },
    }),
    prisma.productDefinition.findUnique({
      where: { code: input.productCode },
      select: { code: true },
    }),
  ]);
  if (!binder) throw new BinderProductAuthorityError('BINDER_NOT_FOUND', 'Binder is unavailable in this workspace.');
  if (!product) throw new BinderProductAuthorityError('PRODUCT_NOT_FOUND', `No product definition exists for ${input.productCode}.`);
  if ((input.status ?? 'ACTIVE') === 'ACTIVE' && binder.status !== 'ACTIVE') {
    throw new BinderProductAuthorityError('BINDER_NOT_ACTIVE', 'An ACTIVE product authority requires an ACTIVE binder.');
  }
  assertDateRange(input.effectiveFrom, input.effectiveTo);
}

export async function validateBinderProductAuthority(
  raw: BinderProductAuthorityCreateInput,
): Promise<{ input: BinderProductAuthorityCreateInput; existing: BinderProductAuthorityView | null }> {
  const input = BinderProductAuthorityCreateSchema.parse(raw);
  await assertReferences(input);
  return { input, existing: await readBinderProductAuthority(input.binderId, input.productCode) };
}

export async function listBinderProductAuthorities(binderId: string): Promise<BinderProductAuthorityView[]> {
  const tenantId = getTenantConfig().id;
  const binder = await tenantScopedPrisma.binder.findFirst({
    where: { id: binderId, operatingTenantId: tenantId },
    select: { id: true },
  });
  if (!binder) throw new BinderProductAuthorityError('BINDER_NOT_FOUND', 'Binder is unavailable in this workspace.');
  const rows = await tenantScopedPrisma.binderProductAuthority.findMany({
    where: { binderId, operatingTenantId: tenantId },
    orderBy: [{ status: 'asc' }, { productCode: 'asc' }],
  });
  return rows.map((row) => view(row as AuthorityRecord));
}

export async function readBinderProductAuthority(
  binderId: string,
  productCode: string,
): Promise<BinderProductAuthorityView | null> {
  const row = await tenantScopedPrisma.binderProductAuthority.findFirst({
    where: {
      binderId,
      productCode: productCode.toUpperCase(),
      operatingTenantId: getTenantConfig().id,
    },
  });
  return row ? view(row as AuthorityRecord) : null;
}

export async function upsertBinderProductAuthority(
  raw: BinderProductAuthorityCreateInput,
): Promise<{ created: boolean; authority: BinderProductAuthorityView }> {
  const { input, existing } = await validateBinderProductAuthority(raw);
  const tenantId = getTenantConfig().id;
  const data = {
    classOfBusiness: input.classOfBusiness,
    riskCode: input.riskCode ?? null,
    territorialScope: input.territorialScope ?? [],
    maxPremiumAnnual: input.maxPremiumAnnual ?? null,
    maxPolicyPeriodDays: input.maxPolicyPeriodDays ?? null,
    maxAdvanceInceptionDays: input.maxAdvanceInceptionDays ?? null,
    authorityClasses: input.authorityClasses ?? [],
    effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
    effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
    notes: input.notes ?? null,
    status: input.status ?? 'ACTIVE',
  };
  const row = await tenantScopedPrisma.binderProductAuthority.upsert({
    where: { binderId_productCode: { binderId: input.binderId, productCode: input.productCode } },
    update: data,
    create: {
      operatingTenantId: tenantId,
      binderId: input.binderId,
      productCode: input.productCode,
      ...data,
    },
  });
  return { created: !existing, authority: view(row as AuthorityRecord) };
}

export async function updateBinderProductAuthority(
  raw: BinderProductAuthorityUpdateInput,
): Promise<BinderProductAuthorityView> {
  const input = BinderProductAuthorityUpdateSchema.parse(raw);
  const existing = await readBinderProductAuthority(input.binderId, input.productCode);
  if (!existing) throw new BinderProductAuthorityError('AUTHORITY_NOT_FOUND', 'Binder product authority was not found.');
  const merged = BinderProductAuthorityCreateSchema.parse({
    ...existing,
    ...input,
    effectiveFrom: input.effectiveFrom === undefined ? existing.effectiveFrom : input.effectiveFrom,
    effectiveTo: input.effectiveTo === undefined ? existing.effectiveTo : input.effectiveTo,
  });
  return (await upsertBinderProductAuthority(merged)).authority;
}
