/**
 * MBE Repository — Prisma-backed data access for the MagicB Endorsement domain.
 *
 * CHAMPS: Extracted from domain/service.ts to keep the domain service pure.
 * Owns all DB operations (CRUD, transactions). The domain service owns business
 * logic (validation, pricing, orchestration).
 */

import type { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function toInputJson(value: unknown) {
    return JSON.parse(JSON.stringify(value ?? null));
}

// ─── Read Operations ─────────────────────────────────────────────────

export async function findAppliedEndorsements(policyId: string, statuses: readonly string[]) {
    return tenantScopedPrisma.endorsementInstance.findMany({
        where: { policyId, status: { in: [...statuses] } },
        include: { template: true },
    });
}

export async function findPolicyById(policyId: string) {
    return tenantScopedPrisma.policy.findUnique({ where: { id: policyId } });
}

export async function findPolicyStateCurrentSnapshot(policyId: string) {
    return tenantScopedPrisma.policyStateCurrent.findUnique({
        where: { policyId },
        select: { snapshot: true },
    });
}

export async function findEndorsementTemplate(programCode: string, code: string, version: number) {
    return prisma.endorsementTemplate.findUnique({
        where: { programCode_code_version: { programCode, code, version } },
    });
}

export async function findEndorsementInstance(instanceId: string, includeTransaction = false) {
    return tenantScopedPrisma.endorsementInstance.findUnique({
        where: { id: instanceId },
        include: { transaction: includeTransaction },
    });
}

// ─── Write Operations ────────────────────────────────────────────────

export async function createEndorsementWithTransaction(data: {
    userId: string;
    policyId: string;
    endorsementCode: string;
    templateId: string;
    title: string;
    scope: string;
    targetId?: string;
    params: unknown;
    status: string;
    premiumDelta: number;
}) {
    return runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
        const count = await tx.riskTransaction.count({ where: { policyId: data.policyId } });

        const riskTxData: WithoutTenantScope<Prisma.RiskTransactionUncheckedCreateInput> = {
            policyId: data.policyId,
            transactionType: 'ENDORSEMENT',
            status: data.status === 'APPLIED' ? 'BOUND' : 'REFERRED',
            effectiveDate: new Date(),
            createdBy: data.userId,
            transactionNumber: count + 1,
            changeReason: `Applied Endorsement ${data.endorsementCode}`,
        };
        const rtx = await tx.riskTransaction.create({
            data: riskTxData as Prisma.RiskTransactionUncheckedCreateInput,
        });

        const endorsementInstanceData: WithoutTenantScope<Prisma.EndorsementInstanceUncheckedCreateInput> = {
            policyId: data.policyId,
            transactionId: rtx.id,
            code: data.endorsementCode,
            title: data.title,
            scope: data.scope,
            targetId: data.targetId,
            params: toInputJson(data.params),
            effectiveFrom: new Date(),
            status: data.status,
            premiumDelta: data.premiumDelta,
            templateId: data.templateId,
        };
        const instance = await tx.endorsementInstance.create({
            data: endorsementInstanceData as Prisma.EndorsementInstanceUncheckedCreateInput,
        });

        return instance;
    });
}

export async function approveEndorsementTransaction(
    instanceId: string,
    userId: string,
    transactionId: string,
    transactionStatus: string
) {
    return runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
        const updated = await tx.endorsementInstance.update({
            where: { id: instanceId },
            data: {
                status: 'APPLIED',
                approvedBy: userId,
                approvedAt: new Date(),
            },
        });

        if (transactionStatus === 'REFERRED') {
            await tx.riskTransaction.update({
                where: { id: transactionId },
                data: { status: 'BOUND' },
            });
        }

        return updated;
    });
}

export async function declineEndorsementTransaction(instanceId: string, transactionId: string | null) {
    return runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
        const updated = await tx.endorsementInstance.update({
            where: { id: instanceId },
            data: { status: 'REJECTED' },
        });

        if (transactionId) {
            await tx.riskTransaction.update({
                where: { id: transactionId },
                data: { status: 'DECLINED' },
            });
        }

        return updated;
    });
}

export async function supersedeEndorsementTransaction(
    instanceId: string,
    userId: string,
    existingApprovedBy: string | null,
    existingApprovedAt: Date | null
) {
    return runTenantScopedTransaction(async (_tx) => {
      const tx = _tx as Prisma.TransactionClient;
        return tx.endorsementInstance.update({
            where: { id: instanceId },
            data: {
                status: 'SUPERSEDED',
                approvedBy: userId || existingApprovedBy,
                approvedAt: existingApprovedAt || new Date(),
            },
        });
    });
}

export async function findOrCreateTemplate(template: {
    program_code: string;
    code: string;
    title: string;
    legal_text: string;
    type: string;
    scope: string;
    parameters_schema: unknown;
    default_params: unknown;
    rules: unknown;
    ui: unknown;
    document_template: string;
    requires_underwriter_approval: boolean;
    allowed_with: string[];
    disallowed_with: string[];
    jurisdiction: string | string[];
}) {
    const jurisdictionValue = Array.isArray(template.jurisdiction)
        ? template.jurisdiction.map((item) => String(item || '')).filter(Boolean)
        : [String(template.jurisdiction || '')].filter(Boolean);
    const existing = await prisma.endorsementTemplate.findUnique({
        where: {
            programCode_code_version: {
                programCode: template.program_code,
                code: template.code,
                version: 1,
            },
        },
    });

    if (existing) return existing;

    return prisma.endorsementTemplate.create({
        data: {
            programCode: template.program_code,
            code: template.code,
            title: template.title,
            description: template.legal_text,
            type: template.type,
            scope: template.scope,
            parametersSchema: toInputJson(template.parameters_schema),
            defaultParams: toInputJson(template.default_params),
            rules: toInputJson(template.rules),
            ui: toInputJson(template.ui),
            documentTemplate: template.document_template,
            requiresUnderwriterApproval: template.requires_underwriter_approval,
            allowedWith: template.allowed_with,
            disallowedWith: template.disallowed_with,
            jurisdiction: jurisdictionValue,
            version: 1,
        },
    });
}
