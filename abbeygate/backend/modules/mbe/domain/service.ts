import { MagicBRegistry, type EndorsementCatalog } from './registry.js';
import { MagicBRulesEngine } from './rulesEngine.js';
import type { QuoteData } from '../../../platform/types/autoInsurance.js';
import {
    findAppliedEndorsements,
    findPolicyById,
    findEndorsementTemplate,
    findEndorsementInstance,
    createEndorsementWithTransaction,
    approveEndorsementTransaction,
    declineEndorsementTransaction,
    supersedeEndorsementTransaction,
    findOrCreateTemplate,
    findPolicyStateCurrentSnapshot,
} from '../app/mbeRepository.js';
import { getOrInitProgramMbeProductConfig } from './programProduct.js';
import { resolveEffectiveCoverageContract } from '../../policy/app/coverageSelectionContract.js';
import { ProductRegistry } from '../../policy/domain/ProductRegistry.js';

/** Resolves the product-scoped endorsement catalog for a policy. */
function catalogForPolicy(policy: unknown): EndorsementCatalog {
    const productType = String((policy as { productType?: unknown })?.productType || '').trim().toUpperCase();
    if (!productType) {
        throw new Error('Policy is missing productType; cannot resolve endorsement catalog.');
    }
    return MagicBRegistry.forProduct(productType);
}

const ACTIVE_ENDORSEMENT_STATUSES = ['APPLIED', 'PENDING'] as const;
type ActiveEndorsementStatus = (typeof ACTIVE_ENDORSEMENT_STATUSES)[number];

function resolveEndorsementStatus(requiresUnderwriterApproval: boolean): ActiveEndorsementStatus {
    return requiresUnderwriterApproval ? 'PENDING' : 'APPLIED';
}

function toQuoteData(value: unknown): QuoteData {
    return value as QuoteData;
}

function quoteDataToRecord(quoteData: QuoteData): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(quoteData)) out[k] = v;
    return out;
}

export function normalizeQuoteDataForPricing(source: unknown): QuoteData {
    const quoteData = toQuoteData(source || {});
    const record = quoteDataToRecord(quoteData);
    if (typeof record.requiredExcess === 'number') {
        record.requiredExcess = String(record.requiredExcess);
    }
    return toQuoteData(record);
}

function mergeEffectiveEndorsements(
    resolved: Array<{ code: string; params?: Record<string, unknown> }>,
    existing: Array<{ code: string; params: Record<string, unknown> }>
): Array<{ code: string; params: Record<string, unknown> }> {
    const byCode = new Map<string, { code: string; params: Record<string, unknown> }>();
    resolved.forEach((entry) => {
        const code = String(entry.code || '').trim();
        if (!code) return;
        byCode.set(code, { code, params: (entry.params || {}) as Record<string, unknown> });
    });
    existing.forEach((entry) => {
        const code = String(entry.code || '').trim();
        if (!code) return;
        byCode.set(code, { code, params: entry.params || {} });
    });
    return [...byCode.values()];
}

export class MagicBService {

    static async getAppliedEndorsements(policyId: string) {
        return findAppliedEndorsements(policyId, ACTIVE_ENDORSEMENT_STATUSES);
    }

    static async previewEndorsement(policyId: string, endorsementCode: string, params: Record<string, unknown>, targetId?: string) {
        const policy = await findPolicyById(policyId);
        if (!policy) throw new Error('Policy not found');

        const catalog = catalogForPolicy(policy);
        const template = catalog.get(endorsementCode);
        if (!template) throw new Error(`Template '${endorsementCode}' not found in ${catalog.productType} catalog`);

        const existing = await this.getAppliedEndorsements(policyId) as Array<{ code: string; params: Record<string, unknown> }>;
        const quoteData = normalizeQuoteDataForPricing(policy.quoteData || {});
        const rawRecord = quoteDataToRecord(quoteData);
        const asRec = (v: unknown): Record<string, unknown> =>
            v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
        const quoteDataRecord: Record<string, unknown> = {
            ...rawRecord,
            flags: {
                ...asRec(rawRecord.flags),
                isComprehensive: String(rawRecord.coverRequired || '') !== 'Third Party Liability',
                windscreenDisabled: rawRecord.windscreenCover === false || rawRecord.disableWindscreen === true,
                isMotorbike:
                    Boolean(asRec(rawRecord.flags).isMotorbike) ||
                    String(rawRecord.vehicleType || '').toLowerCase().includes('motorbike') ||
                    String(rawRecord.vehicleType || '').toLowerCase().includes('motorcycle'),
                classic_car:
                    Boolean(asRec(rawRecord.flags).classic_car) ||
                    String(rawRecord.vehicleType || '').toLowerCase().includes('classic'),
            },
        };
        const programId = String((policy as { programId?: unknown }).programId || '').trim();
        const currentState = await findPolicyStateCurrentSnapshot(policyId);
        const currentSnapshot = currentState && typeof currentState.snapshot === 'object'
            ? asRec(currentState.snapshot)
            : {};
        const cfg = programId ? await getOrInitProgramMbeProductConfig(programId) : null;
        const resolvedCoverage = cfg
            ? resolveEffectiveCoverageContract({
                quoteData: quoteDataRecord,
                cfg,
                storedSelection: currentSnapshot.coverageSelection,
                programId,
                source: 'MBE_PREVIEW',
            })
            : null;
        const resolvedDefaults = resolvedCoverage?.resolvedCoverageSet?.applied || [];
        const effectiveExisting = mergeEffectiveEndorsements(resolvedDefaults, existing);
        const existingCodes = effectiveExisting.map((e) => e.code);

        // Validate
        const validation = MagicBRulesEngine.validate(
            template,
            {
                policySnapshot: quoteDataRecord,
                endorsementCode,
                params,
                targetId,
                existingEndorsements: existingCodes,
            },
            existingCodes,
            catalog,
        );

        if (validation.blocking) {
            return { success: false, validation, premiumDelta: 0, newPremium: 0, newExcess: 0 };
        }

        // Calculate Pricing Impact via product adapter
        const existingForCalc = effectiveExisting.map((e) => ({ code: e.code, params: e.params }));
        const proposedForCalc = [...existingForCalc, { code: endorsementCode, params }];

        const productType = String((policy as { productType?: unknown }).productType || '').toUpperCase();
        const adapter = ProductRegistry.getInstance().getAdapter(productType);
        if (!adapter) throw new Error(`No product adapter for type '${productType}'; cannot calculate endorsement premium`);

        const oldCalc = await adapter.calculateEndorsementPremium(quoteData, existingForCalc);
        const newCalc = await adapter.calculateEndorsementPremium(quoteData, proposedForCalc);

        const premiumDelta = newCalc.premium - oldCalc.premium;

        return {
            success: true,
            validation,
            premiumDelta,
            newPremium: newCalc.premium,
            newExcess: newCalc.policyExcess,
            docPreview: `Endorsement Schedule: ${template.code} - ${template.title}`
        };
    }

    static async applyEndorsement(userId: string, policyId: string, endorsementCode: string, params: Record<string, unknown>, targetId?: string) {
        const policy = await findPolicyById(policyId);
        if (!policy) throw new Error('Policy not found');
        const catalog = catalogForPolicy(policy);

        // Self-healing: seed this product's catalog into the endorsementTemplate table
        // so `findEndorsementTemplate` succeeds. Idempotent; safe per-apply.
        await this.ensureTemplatesSeededForCatalog(catalog);

        const preview = await this.previewEndorsement(policyId, endorsementCode, params, targetId);
        if (!preview.success) throw new Error(`Validation failed: ${preview.validation.messages.join(', ')}`);

        const template = catalog.get(endorsementCode);
        if (!template) throw new Error(`Template '${endorsementCode}' not found in ${catalog.productType} catalog`);

        const dbTemplate = await findEndorsementTemplate(template.program_code, template.code, 1);
        if (!dbTemplate) throw new Error(`Internal Error: Template ${endorsementCode} not found in DB after seeding.`);

        const status = resolveEndorsementStatus(template.requires_underwriter_approval);

        return createEndorsementWithTransaction({
            userId,
            policyId,
            endorsementCode,
            templateId: dbTemplate.id,
            title: template.title,
            scope: template.scope,
            targetId,
            params,
            status,
            premiumDelta: preview.premiumDelta,
        });
    }

    static async approveEndorsement(instanceId: string, userId: string) {
        const instance = await findEndorsementInstance(instanceId, true);
        if (!instance) throw new Error('Endorsement Instance not found');
        if (instance.status !== 'PENDING' && instance.status !== 'REFERRED') {
            throw new Error(`Cannot approve endorsement in status ${instance.status}`);
        }

        const transaction = (instance as { transaction?: { status: string } }).transaction;
        return approveEndorsementTransaction(
            instanceId,
            userId,
            instance.transactionId,
            transaction?.status || '',
        );
    }

    static async declineEndorsement(instanceId: string, _userId: string) {
        const instance = await findEndorsementInstance(instanceId);
        if (!instance) throw new Error('Endorsement Instance not found');

        return declineEndorsementTransaction(instanceId, instance.transactionId);
    }

    /**
     * "Remove" an endorsement from rating by superseding the instance.
     * For MVP we do not hard-delete; we preserve audit history and make pricing ignore it.
     */
    static async supersedeEndorsement(instanceId: string, userId: string) {
        const instance = await findEndorsementInstance(instanceId);
        if (!instance) throw new Error('Endorsement Instance not found');
        if (instance.status === 'SUPERSEDED') return instance;

        return supersedeEndorsementTransaction(
            instanceId,
            userId,
            instance.approvedBy,
            instance.approvedAt,
        );
    }

    /**
     * Seeds a specific product's endorsement templates into the DB so
     * `findEndorsementTemplate` can resolve them at apply-time. Safe to call
     * repeatedly — `findOrCreateTemplate` is idempotent per (programCode, code, version).
     */
    static async ensureTemplatesSeededForCatalog(catalog: EndorsementCatalog) {
        for (const t of catalog.getAll()) {
            await findOrCreateTemplate(t);
        }
    }

    /**
     * Seeds every registered product's endorsement templates into the DB.
     * Intended for boot-time warm-up; per-request paths should prefer
     * `ensureTemplatesSeededForCatalog` with the resolved product catalog.
     */
    static async ensureAllTemplatesSeeded() {
        for (const adapter of ProductRegistry.getInstance().getAllAdapters()) {
            const catalog = MagicBRegistry.forProduct(adapter.productType);
            await this.ensureTemplatesSeededForCatalog(catalog);
        }
    }
}
