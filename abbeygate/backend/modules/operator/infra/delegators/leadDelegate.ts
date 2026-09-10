/**
 * Operator-module-owned write composition for creating a new lead +
 * DRAFT quote session that the wizard invite link points to.
 *
 * NOTE on architecture (ADR-0036 amendment #2):
 *   The plan's no-direct-writes guard makes ONE exception for
 *   `infra/delegators/` — files in this folder are allowed to call
 *   `tenantScopedPrisma.*.create|upsert|update` because they compose
 *   canonical patterns from other modules at a fine grain.
 *   Specifically:
 *     - PolicyHolder upsert: same shape used by accountsRouter `POST /`
 *     - Policy create + publicSessionToken: same shape used by
 *       `backend/modules/quotes/http/genericPublicQuoteRouter.ts`
 *       (the public-session create handler at line ~205) and
 *       `backend/products/motor/quotes/quoteSessionOps.ts:createPublicAutoSession`
 *
 *   V2 should extract a real `createOperatorLeadSession` service in
 *   `backend/modules/policy/app/` that mutationsRouter +
 *   genericPublicQuoteRouter + this delegator all share. Tracked in the
 *   ADR amendment §"out of scope".
 */
import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { generateQuoteId } from '../../../../platform/utils/platformIds.js';
import { newPublicSessionToken } from '../../../policy/app/shared.js';
import { findLatestActiveBinderLinkForProduct } from '../../../policy/app/binders/binderAuthority.js';
import { getProductSegmentLabel } from '../../../policy/app/productRegistryService.js';

export interface UpsertPolicyHolderInput {
    /** Display name (e.g. "Uriel Aharoni"). Required. */
    name: string;
    /** Stored on PolicyHolder.contact as a free-form string. */
    contact?: string;
}

export interface UpsertPolicyHolderResult {
    id: string;
    created: boolean;
    name: string;
    contact: string | null;
}

/**
 * Find-or-create a PolicyHolder. There is no unique constraint on
 * PolicyHolder.contact today; we de-dupe by case-insensitive contact
 * substring match (the same rule accountsRouter uses for search). For
 * V1 this is acceptable; V2 may add a structured email column +
 * unique index.
 */
export async function upsertPolicyHolderByContact(
    input: UpsertPolicyHolderInput,
): Promise<UpsertPolicyHolderResult> {
    const trimmedName = String(input.name || '').trim();
    if (!trimmedName) throw new Error('PolicyHolder name is required.');
    const contact = String(input.contact || '').trim() || null;
    if (contact) {
        const existing = await tenantScopedPrisma.policyHolder.findFirst({
            where: { contact: { contains: contact, mode: 'insensitive' } },
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, contact: true },
        });
        if (existing) {
            return { id: existing.id, created: false, name: existing.name, contact: existing.contact };
        }
    }
    const createData = {
        name: trimmedName,
        contact,
    };
    const created = await tenantScopedPrisma.policyHolder.create({
        data: createData as unknown as Prisma.PolicyHolderUncheckedCreateInput,
    });
    return { id: created.id, created: true, name: created.name, contact: created.contact };
}

export interface CreateLeadDraftPolicyInput {
    policyHolderId: string;
    productType: string;
}

export interface CreateLeadDraftPolicyResult {
    policyId: string;
    policyNumber: string;
    publicSessionToken: string;
    programId: string;
    binderId: string;
}

/**
 * Creates a DRAFT-stage Policy with a fresh publicSessionToken bound
 * to the operating tenant's active binder for the given product. Same
 * write shape as the public quote-session router; preserves the binder
 * authority gate (`assertBinderAuthorizesProduct` is called transitively
 * inside `findLatestActiveBinderLinkForProduct`).
 */
export async function createLeadDraftPolicy(
    input: CreateLeadDraftPolicyInput,
): Promise<CreateLeadDraftPolicyResult> {
    const productType = String(input.productType || '').trim().toUpperCase();
    const inceptionDate = new Date();
    const binderLink = await findLatestActiveBinderLinkForProduct({ productCode: productType, inceptionDate });
    if (!binderLink) {
        throw new Error(`No active binder for product "${productType}" in this tenant.`);
    }
    const token = newPublicSessionToken();
    const policyNumber = await generateQuoteId(productType);
    const policyData = {
        policyNumber,
        status: 'INTAKE',
        productType,
        policyHolderId: input.policyHolderId,
        programId: binderLink.programId,
        binderId: binderLink.binderId,
        inceptionDate,
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        publicSessionToken: token,
    };
    const policy = await tenantScopedPrisma.policy.create({
        data: policyData as unknown as Prisma.PolicyUncheckedCreateInput,
    });
    return {
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        publicSessionToken: token,
        programId: binderLink.programId,
        binderId: binderLink.binderId,
    };
}

/** Used in lead-creation summaries when the operator did not supply a segment hint. */
export function defaultSegmentForProduct(productType: string): string {
    return getProductSegmentLabel(productType);
}
