import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import {
    DraftDeltaSchema,
    EMPTY_DRAFT_DELTA,
    mergeDraftDelta,
    type DraftDelta,
} from '../../domain/draftDelta.js';
import type { ConfigDraftStatus, ProductLaunchDraft } from '../../domain/productLaunchDraft.js';
import type { Prisma } from '@prisma/client';

/**
 * Single repository for ProductLaunchDraft rows. Reads/writes always
 * go through tenant-scoped Prisma per ADR-0009 / guard
 * `no-bare-prisma-on-tenant-scoped-models`.
 *
 * Sole caller of this repository is `backend/modules/configuration/app/*`
 * — per ADR-0037 and the canonical-ownership row "Product launch
 * staging", no other module reads ProductLaunchDraft.
 */

type DraftRow = {
    id: string;
    operatingTenantId: string;
    name: string;
    baseTemplateId: string;
    productCode: string;
    status: string;
    delta: Prisma.JsonValue;
    publishedProgramId: string | null;
    publishedBinderId: string | null;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
};

function fromRow(row: DraftRow): ProductLaunchDraft {
    const parsedDelta = DraftDeltaSchema.safeParse(row.delta ?? {});
    return {
        id: row.id,
        operatingTenantId: row.operatingTenantId,
        name: row.name,
        baseTemplateId: row.baseTemplateId,
        productCode: row.productCode,
        status: row.status as ConfigDraftStatus,
        delta: parsedDelta.success ? parsedDelta.data : EMPTY_DRAFT_DELTA,
        publishedProgramId: row.publishedProgramId,
        publishedBinderId: row.publishedBinderId,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export async function createDraft(args: {
    name: string;
    baseTemplateId: string;
    productCode: string;
    delta: DraftDelta;
    createdByUserId: string;
}): Promise<ProductLaunchDraft> {
    const row = (await tenantScopedPrisma.productLaunchDraft.create({
        data: {
            name: args.name,
            baseTemplateId: args.baseTemplateId,
            productCode: args.productCode,
            status: 'draft',
            delta: args.delta as Prisma.InputJsonValue,
            createdByUserId: args.createdByUserId,
        } as unknown as Prisma.ProductLaunchDraftUncheckedCreateInput,
    })) as unknown as DraftRow;
    return fromRow(row);
}

export async function findDraft(id: string): Promise<ProductLaunchDraft | null> {
    const row = (await tenantScopedPrisma.productLaunchDraft.findUnique({
        where: { id },
    })) as unknown as DraftRow | null;
    return row ? fromRow(row) : null;
}

export async function listDrafts(): Promise<ProductLaunchDraft[]> {
    const rows = (await tenantScopedPrisma.productLaunchDraft.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 50,
    })) as unknown as DraftRow[];
    return rows.map(fromRow);
}

export async function patchDelta(
    id: string,
    deltaPatch: DraftDelta,
): Promise<ProductLaunchDraft | null> {
    const current = await findDraft(id);
    if (!current) return null;
    const merged = mergeDraftDelta(current.delta, deltaPatch);
    const row = (await tenantScopedPrisma.productLaunchDraft.update({
        where: { id },
        data: {
            delta: merged as Prisma.InputJsonValue,
            // Re-editing a validated/simulated draft reverts to draft so
            // it must re-validate before publish (ADR-0037).
            status: current.status === 'sandbox_published' || current.status === 'archived'
                ? current.status
                : 'draft',
        } as unknown as Prisma.ProductLaunchDraftUncheckedUpdateInput,
    })) as unknown as DraftRow;
    return fromRow(row);
}

export async function updateStatus(
    id: string,
    status: ConfigDraftStatus,
    extras?: { publishedProgramId?: string; publishedBinderId?: string },
): Promise<ProductLaunchDraft | null> {
    const row = (await tenantScopedPrisma.productLaunchDraft.update({
        where: { id },
        data: {
            status,
            publishedProgramId: extras?.publishedProgramId ?? undefined,
            publishedBinderId: extras?.publishedBinderId ?? undefined,
        } as unknown as Prisma.ProductLaunchDraftUncheckedUpdateInput,
    })) as unknown as DraftRow;
    return fromRow(row);
}
