/**
 * Reconciliation Repository — Prisma-backed data access for reconciliation domain.
 *
 * CHAMPS: Extracted from domain/reconciliation/matcher.ts to keep domain pure.
 * All Prisma queries live here; the domain works with plain objects and business logic.
 */

import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { enqueueAccounts360ProjectionUpdate } from '../../accounts360/infra/projections/accounts360Projection.js';
import { enqueueAccountIntelligenceProjectionUpdate } from '../../accounts360/infra/projections/accountIntelligenceProjection.js';

// ─── Reconciliation Queries ──────────────────────────────────────────

export async function findPaidReconciliations(invoiceId: string) {
    return tenantScopedPrisma.reconciliation.findMany({
        where: {
            invoiceId,
            status: { in: ['MATCHED', 'PARTIAL'] },
        },
    });
}

export async function updateReconciliation(
    id: string,
    data: { invoiceId: string; status: string; matchedAmount: number }
) {
    return tenantScopedPrisma.reconciliation.update({
        where: { id },
        data: {
            ...data,
            updatedAt: new Date(),
        },
    });
}

// ─── Invoice Queries ─────────────────────────────────────────────────

export async function updateInvoiceStatus(
    invoiceId: string,
    data: { status: string; paidDate?: Date }
) {
    const updated = await tenantScopedPrisma.invoice.update({
        where: { id: invoiceId },
        data,
    });
    const policyId = String(updated.policyId || '').trim();
    if (policyId) {
        const policy = await tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, select: { policyHolderId: true } });
        const accountId = String(policy?.policyHolderId || '').trim();
        if (accountId) {
            await enqueueAccounts360ProjectionUpdate(prisma, accountId);
            await enqueueAccountIntelligenceProjectionUpdate(prisma, accountId);
        }
    }
    return updated;
}

export async function createBalanceInvoice(data: {
    policyId: string | null;
    amount: number;
    dueDate: Date;
}) {
    const created = await tenantScopedPrisma.invoice.create({
        data: {
            policyId: data.policyId,
            amount: data.amount,
            status: 'DRAFT',
            dueDate: data.dueDate,
        } as unknown as Prisma.InvoiceUncheckedCreateInput,
    });
    const policyId = String(created.policyId || '').trim();
    if (policyId) {
        const policy = await tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, select: { policyHolderId: true } });
        const accountId = String(policy?.policyHolderId || '').trim();
        if (accountId) {
            await enqueueAccounts360ProjectionUpdate(prisma, accountId);
            await enqueueAccountIntelligenceProjectionUpdate(prisma, accountId);
        }
    }
    return created;
}

// ─── Document Queries ────────────────────────────────────────────────

export async function createReceiptDocument(data: {
    policyId: string;
    storageUri: string;
    filename: string;
}) {
    return tenantScopedPrisma.document.create({
        data: {
            policyId: data.policyId,
            type: 'RECEIPT',
            storageUri: data.storageUri,
            filename: data.filename,
        } as unknown as Prisma.DocumentUncheckedCreateInput,
    });
}
