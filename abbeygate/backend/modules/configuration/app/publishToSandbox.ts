import { Prisma } from '@prisma/client';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import type { TenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { logger } from '../../../platform/utils/logger.js';
import { McpToolError } from '../../mcp/domain/toolError.js';
import { isPublishable } from '../domain/productLaunchDraft.js';
import {
    findDraft,
    updateStatus,
} from '../infra/repositories/productLaunchDraftRepo.js';
import { getTemplate } from '../infra/templates/index.js';

export interface PublishToSandboxInput {
    draftId: string;
    sandboxTenantSlug: string;
    confirmationText: string;
}

export interface PublishToSandboxOutput {
    sandboxConfigVersionId: string;
    publishedProgramId: string;
    publishedBinderId: string;
    status: 'sandbox_published';
    summary: string;
}

/**
 * The ONLY canonical-row writer in the configuration module (ADR-0037).
 *
 * Hard gates (spec §9.8 + ADR-0037):
 *   - Draft status must be `simulated`.
 *   - The user's permission set must include `configuration.publish_sandbox`
 *     (the MCP layer's authorizeToolCall enforces this before run() is
 *     invoked, so we only re-check it here as defense-in-depth).
 *   - Target tenant kind must be SYNTHETIC.
 *   - Confirmation text must match the canonical phrase
 *     `PUBLISH <draft.name> TO SANDBOX`.
 *
 * Writes happen inside one Prisma transaction inside
 * `runWithOperatingTenant(syntheticTenantConfig, ...)` — the same
 * tenant-isolation posture as ADR-0019.
 */
export async function publishToSandbox(
    input: PublishToSandboxInput,
    callerPermissions: readonly string[],
): Promise<PublishToSandboxOutput> {
    const draft = await findDraft(input.draftId);
    if (!draft) {
        throw new McpToolError({ code: 'DRAFT_NOT_FOUND', message: `No draft "${input.draftId}".` });
    }
    if (!isPublishable(draft.status)) {
        throw new McpToolError({
            code: 'PUBLISH_BLOCKED',
            message: `Draft "${input.draftId}" must be in status "simulated" to publish; current status is "${draft.status}".`,
            suggestedFix: 'Run config.simulation.runDemoScenarioPack first.',
        });
    }
    if (!callerPermissions.includes('configuration.publish_sandbox')) {
        throw new McpToolError({
            code: 'UNAUTHORIZED',
            message: 'Caller lacks configuration.publish_sandbox permission.',
        });
    }
    const expectedConfirmation = `PUBLISH ${draft.name} TO SANDBOX`;
    if (input.confirmationText !== expectedConfirmation) {
        throw new McpToolError({
            code: 'PUBLISH_BLOCKED',
            message: `Confirmation text must equal "${expectedConfirmation}".`,
        });
    }

    const targetTenant = await prisma.tenant.findUnique({
        where: { tenantSlug: input.sandboxTenantSlug },
        select: {
            id: true,
            tenantSlug: true,
            kind: true,
            countryCode: true,
            country: true,
            currency: true,
            adminFee: true,
            iptJson: true,
            publicBaseUrl: true,
            fromEmail: true,
            legalPack: true,
            brandLogos: true,
            defaultBrokerName: true,
        },
    });
    if (!targetTenant) {
        throw new McpToolError({
            code: 'PUBLISH_BLOCKED',
            message: `Sandbox tenant "${input.sandboxTenantSlug}" does not exist.`,
            suggestedFix:
                'Seed a SYNTHETIC tenant via backend/seed/synthetic-tenants.ts before publishing Config MCP drafts.',
        });
    }
    if (targetTenant.kind !== 'SYNTHETIC') {
        throw new McpToolError({
            code: 'PUBLISH_BLOCKED',
            message: `Target tenant "${input.sandboxTenantSlug}" is ${targetTenant.kind}; Config MCP V1 only publishes into SYNTHETIC tenants.`,
        });
    }

    const sandboxTenantConfig = buildSandboxTenantConfig(targetTenant);
    const template = getTemplate(draft.baseTemplateId);

    const publishedIds = await runWithOperatingTenant(sandboxTenantConfig, async () => {
        return tenantScopedPrisma.$transaction(async (tx) => {
            const programName = `${draft.name} (Config MCP — ${new Date().toISOString().slice(0, 10)})`;
            const programMetadata = composeProgramMetadata(draft);
            const program = await tx.program.create({
                data: {
                    name: programName,
                    status: 'ACTIVE',
                    productType: draft.productCode,
                    metadata: programMetadata as Prisma.InputJsonValue,
                } as unknown as Prisma.ProgramUncheckedCreateInput,
            });

            // Binder + authority — clone from template defaultBinder if
            // present (Classic Car), else inherit the template-level
            // motor binder unchanged.
            let binderId: string;
            if (template?.defaultBinder) {
                const binderConfig: Prisma.InputJsonValue = {
                    productType: draft.productCode,
                    scope: {
                        authorizedClass: template.defaultBinder.classOfBusiness,
                        riskLocationCountries: template.defaultBinder.territorialScope,
                    },
                };
                const binder = await tx.binder.create({
                    data: {
                        coverholderName: template.defaultBinder.coverholderName,
                        coverholderPin: template.defaultBinder.coverholderPin,
                        umr: template.defaultBinder.umr,
                        agreementNumber: template.defaultBinder.agreementNumber,
                        lloydsReportingVer: 'V5.2',
                        defaultCurrency: targetTenant.currency,
                        settlementCurrency: targetTenant.currency,
                        config: binderConfig,
                        startDate: new Date(),
                        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                        status: 'ACTIVE',
                    } as unknown as Prisma.BinderUncheckedCreateInput,
                });
                binderId = binder.id;
                await tx.binderProductAuthority.create({
                    data: {
                        binderId: binder.id,
                        productCode: draft.productCode,
                        classOfBusiness: template.defaultBinder.classOfBusiness,
                        riskCode: template.defaultBinder.riskCode,
                        territorialScope:
                            draft.delta.binderAuthorityOverrides?.territorialScope ??
                            template.defaultBinder.territorialScope,
                        authorityClasses:
                            draft.delta.binderAuthorityOverrides?.authorityClasses ??
                            template.defaultBinder.authorityClasses,
                        maxPremiumAnnual:
                            draft.delta.binderAuthorityOverrides?.maxPremiumAnnual !== undefined
                                ? draft.delta.binderAuthorityOverrides.maxPremiumAnnual === null
                                    ? null
                                    : new Prisma.Decimal(draft.delta.binderAuthorityOverrides.maxPremiumAnnual)
                                : undefined,
                        maxPolicyPeriodDays:
                            draft.delta.binderAuthorityOverrides?.maxPolicyPeriodDays ?? undefined,
                        maxAdvanceInceptionDays:
                            draft.delta.binderAuthorityOverrides?.maxAdvanceInceptionDays ?? undefined,
                        status: 'ACTIVE',
                        effectiveFrom: new Date(),
                        effectiveTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
                    } as unknown as Prisma.BinderProductAuthorityUncheckedCreateInput,
                });
                await tx.programBinderLink.create({
                    data: {
                        programId: program.id,
                        binderId: binder.id,
                        status: 'ACTIVE',
                    } as unknown as Prisma.ProgramBinderLinkUncheckedCreateInput,
                });
            } else {
                // Template doesn't ship a binder — use the most recent
                // tenant-scoped active binder. Falls back to throwing if
                // none, surfaced as PUBLISH_BLOCKED.
                const existingBinder = await tx.binder.findFirst({
                    where: { status: 'ACTIVE' },
                    orderBy: { updatedAt: 'desc' },
                    select: { id: true },
                });
                if (!existingBinder) {
                    throw new McpToolError({
                        code: 'PUBLISH_BLOCKED',
                        message: `Template "${draft.baseTemplateId}" has no defaultBinder and the sandbox tenant has no active binder to link.`,
                    });
                }
                binderId = existingBinder.id;
                await tx.programBinderLink.create({
                    data: {
                        programId: program.id,
                        binderId,
                        status: 'ACTIVE',
                    } as unknown as Prisma.ProgramBinderLinkUncheckedCreateInput,
                });
            }

            return { programId: program.id, binderId };
        });
    });

    await updateStatus(draft.id, 'sandbox_published', {
        publishedProgramId: publishedIds.programId,
        publishedBinderId: publishedIds.binderId,
    });

    logger.info(
        {
            draftId: draft.id,
            sandboxTenant: input.sandboxTenantSlug,
            programId: publishedIds.programId,
            binderId: publishedIds.binderId,
        },
        'config.sandbox_published',
    );

    return {
        sandboxConfigVersionId: publishedIds.programId,
        publishedProgramId: publishedIds.programId,
        publishedBinderId: publishedIds.binderId,
        status: 'sandbox_published',
        summary:
            `Published "${draft.name}" into sandbox tenant "${input.sandboxTenantSlug}". ` +
            `Program ${publishedIds.programId}, binder ${publishedIds.binderId}.`,
    };
}

function buildSandboxTenantConfig(tenant: {
    id: string;
    tenantSlug: string;
    countryCode: string;
    country: string;
    currency: string;
    adminFee: Prisma.Decimal | number | null;
    iptJson: Prisma.JsonValue;
    publicBaseUrl: string;
    fromEmail: string;
    brandLogos: Prisma.JsonValue;
    legalPack: string;
    defaultBrokerName: string | null;
}): TenantConfig {
    const ipt = (tenant.iptJson && typeof tenant.iptJson === 'object'
        ? tenant.iptJson
        : {}) as { rate?: number; flatFee?: number };
    const adminFee =
        typeof tenant.adminFee === 'number'
            ? tenant.adminFee
            : Number((tenant.adminFee as Prisma.Decimal | null)?.toString() ?? '0');
    const brand = (tenant.brandLogos && typeof tenant.brandLogos === 'object'
        ? tenant.brandLogos
        : {}) as { white?: string; blue?: string };
    return {
        id: tenant.id,
        tenantSlug: tenant.tenantSlug,
        countryCode: tenant.countryCode as TenantConfig['countryCode'],
        country: tenant.country,
        currency: tenant.currency,
        ipt: { rate: ipt.rate, flatFee: ipt.flatFee },
        adminFee,
        publicBaseUrl: tenant.publicBaseUrl,
        fromEmail: tenant.fromEmail,
        brandLogo: { white: brand.white ?? '', blue: brand.blue ?? '' },
        legalPack: tenant.legalPack as TenantConfig['legalPack'],
        defaultBrokerName: tenant.defaultBrokerName ?? undefined,
    };
}

function composeProgramMetadata(draft: Awaited<ReturnType<typeof findDraft>>) {
    if (!draft) return {};
    const metadata: Record<string, unknown> = {
        baseTemplateId: draft.baseTemplateId,
        configMcp: {
            sourceDraftId: draft.id,
            publishedAt: new Date().toISOString(),
        },
    };
    const d = draft.delta;
    if (d.uwOverrides) metadata.abbeygateMotorUwConfig = d.uwOverrides;
    if (d.mbeOverrides) metadata.mbeProductConfig = d.mbeOverrides;
    if (d.questionnaireOverrides) metadata.questionnaireOverrides = d.questionnaireOverrides;
    if (d.approvalRules) metadata.approvalRules = d.approvalRules;
    if (d.jurisdictionOverrides) metadata.jurisdictionOverrides = d.jurisdictionOverrides;
    if (d.billing) metadata.billing = d.billing;
    return metadata;
}
