import crypto from 'node:crypto';
import { resolveProductAvailability } from '../../jurisdiction/app/productAvailability.js';
import type { OperatorEnvelope, OperatorSuccessEnvelope } from '../domain/operatorEnvelope.js';
import { buildOperatorActionContext } from '../domain/operatorContext.js';
import type { McpContext } from '../../mcp/domain/mcpContext.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { logger } from '../../../platform/utils/logger.js';
import {
    dispatchCustomerEmailTrigger,
} from '../../communications/app/customerEmailTriggerService.js';
import {
    createLeadDraftPolicy,
    upsertPolicyHolderByContact,
} from '../infra/delegators/leadDelegate.js';
import { buildProductCatalog } from '../../../products/catalog.js';

const SUPPORTED_PRODUCTS = ['MOTOR', 'HOME', 'TRAVEL', 'HEALTH', 'RENTAL'] as const;

/** The wizard step a product's intake actually begins on. */
function resolveWizardEntryStep(productType: string): string {
    for (const adapter of buildProductCatalog()) {
        if (String(adapter.productType).toUpperCase() !== productType) continue;
        const firstStep = adapter.getRuntimeDefinition()?.intake.firstStep;
        if (firstStep) return firstStep;
    }
    return 'policy-holder';
}

export interface SendWizardLinkInput {
    name: string;
    email: string;
    productType: 'MOTOR' | 'HOME' | 'TRAVEL' | 'HEALTH' | 'RENTAL';
    /** Optional first step deep-link (e.g. 'policy-holder'). Defaults to product's wizard entry. */
    step?: string;
}

export type SendWizardLinkOutput = OperatorEnvelope<{
    policy_holder_id: string;
    policy_id: string;
    wizard_url: string;
    customer_was_existing: boolean;
}>;

/**
 * A1 flow (spec §3.A.1): operator creates a new lead and sends the
 * customer the wizard link.
 *
 * Pipeline:
 *   1. Upsert PolicyHolder by contact (email substring match).
 *   2. Create a DRAFT Policy with publicSessionToken bound to the
 *      tenant's active binder for the product.
 *   3. Build wizard URL from tenant publicBaseUrl.
 *   4. Send the email via the canonical dispatchCustomerEmailTrigger
 *      with idempotency seed `wizard_invite:{tenantId}:{email}:{policyId}`
 *      so retries do not duplicate the send.
 */
export async function sendWizardLink(
    input: SendWizardLinkInput,
    ctx: McpContext,
): Promise<SendWizardLinkOutput> {
    const action = buildOperatorActionContext(ctx);
    const productType = String(input.productType || '').trim().toUpperCase();
    if (!SUPPORTED_PRODUCTS.includes(productType as typeof SUPPORTED_PRODUCTS[number])) {
        return {
            ok: false,
            status: 'error',
            summary: `Unsupported productType "${productType}".`,
            error: {
                code: 'UNSUPPORTED_PRODUCT',
                message: `Supported products: ${SUPPORTED_PRODUCTS.join(', ')}.`,
            },
        };
    }
    const email = String(input.email || '').trim();
    if (!email || !email.includes('@')) {
        return {
            ok: false,
            status: 'missing_required_fields',
            summary: 'A valid email is required for the wizard invite.',
            required_fields: ['email'],
        };
    }

    const tenant = getTenantConfig();
    const availability = resolveProductAvailability(productType);
    if (!availability.available) {
        return { ok: false, status: 'error', summary: 'This product is unavailable in the operating tenant.', error: { code: 'PRODUCT_UNAVAILABLE', message: availability.message } };
    }
    const holder = await upsertPolicyHolderByContact({ name: input.name, contact: email });
    let policy: Awaited<ReturnType<typeof createLeadDraftPolicy>>;
    try {
        policy = await createLeadDraftPolicy({
            policyHolderId: holder.id,
            productType,
        });
    } catch (err) {
        logger.warn({ err, productType, tenantSlug: tenant.tenantSlug }, 'operator.send_wizard_link.draft_policy_failed');
        return {
            ok: false,
            status: 'error',
            summary: `Could not start a ${productType} quote session for this tenant.`,
            error: {
                code: 'BINDER_NOT_ACTIVE',
                message: err instanceof Error ? err.message : 'No active binder for the product.',
            },
        };
    }

    const baseUrl = tenant.publicBaseUrl.replace(/\/$/, '');
    // Deep-link to the product's own wizard entry rather than assuming every
    // product starts at 'policy-holder'; rental, for one, starts at 'vehicle'.
    const step = input.step || resolveWizardEntryStep(productType);
    const wizardUrl = `${baseUrl}/quote/${policy.publicSessionToken}?product=${productType.toLowerCase()}&step=${step}`;

    const idempotencySeed = crypto
        .createHash('sha256')
        .update(`wizard_invite:${tenant.id}:${email.toLowerCase()}:${policy.policyId}`)
        .digest('hex');

    try {
        const dispatched = await dispatchCustomerEmailTrigger({
            trigger: 'QUOTE_RESUME_LINK_REQUESTED',
            entityType: 'POLICY',
            entityId: policy.policyId,
            productCode: productType,
            toEmail: email,
            fromActor: ctx.userId,
            variables: {
                customer: { firstName: input.name.split(' ')[0] || input.name },
                quote: { resumeUrl: wizardUrl, url: wizardUrl, policyNumber: policy.policyNumber },
                policy: { number: policy.policyNumber },
            },
            idempotencySeed,
        });
        if (dispatched.skipped) throw new Error(dispatched.reason || 'Wizard email dispatch was skipped');
    } catch (err) {
        logger.warn({ err, policyId: policy.policyId }, 'operator.send_wizard_link.email_failed');
        return {
            ok: false,
            status: 'error',
            summary: 'Lead created but wizard email failed to send.',
            error: {
                code: 'EMAIL_SEND_FAILED',
                message: err instanceof Error ? err.message : 'Email dispatch error.',
            },
        };
    }

    const envelope: OperatorSuccessEnvelope<{
        policy_holder_id: string;
        policy_id: string;
        wizard_url: string;
        customer_was_existing: boolean;
    }> = {
        ok: true,
        status: 'completed',
        action_id: action.actionId,
        correlation_id: action.correlationId,
        summary: `${holder.created ? 'Created' : 'Updated'} policyholder ${holder.name}, started a ${productType.toLowerCase()} quote session, and sent the wizard link to ${email}.`,
        entities: { policyHolderId: holder.id, policyId: policy.policyId },
        next_actions: ['operator.get_customer_context', 'operator.search_quotes'],
        extra: {
            policy_holder_id: holder.id,
            policy_id: policy.policyId,
            wizard_url: wizardUrl,
            customer_was_existing: !holder.created,
        },
    };
    return envelope;
}
