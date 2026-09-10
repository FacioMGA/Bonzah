import { Job } from 'bullmq';
import { z } from 'zod';
import { logger } from '../../platform/utils/logger.js';
import { dispatchCustomerEmailTrigger } from '../../modules/communications/app/customerEmailTriggerService.js';
import { getTenantConfig, uwReferralEmailsForCountry } from '../../platform/tenant/tenantConfig.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { buildBackOfficePolicyUrl, resolvePublicAppBaseUrlFromTenant } from '../../platform/http/publicAppLinks.js';
import { registerHandler, JobHandler } from '../index.js';

// Schema for the EMAIL.UW_REFERRAL outbox payload.
// Producers (canonical):
//   - backend/modules/quotes/app/quoteRateService.ts (home/travel/health
//     spine) — emits a canonical DomainEventEnvelope with this payload
//     under `data`, so BEHAVIOR.NORMALIZE can ingest the same outbox row.
//   - backend/products/motor/quotes/service.ts (motor rating chokepoint)
//     — legacy FLAT payload at the top level.
// `extractPayload` accepts both shapes.
//
// EMAIL.UW_REFERRAL targets the underwriting team — not the customer —
// because referrals fire pre-bind when there is no policyholder yet.
// Recipient resolution:
//   1. payload.to — explicit caller override (rare; audits/tests).
//   2. UW_REFERRAL_EMAILS_BY_COUNTRY (tenantConfig) — the jurisdiction's
//      underwriting team, resolved from the policy's operating tenant.
// The previous env-var channel (UW_REFERRAL_EMAIL_TO / NOTIFICATIONS_EMAIL_TO)
// was never configured in production, so every referral notification failed
// with "no recipient available" (Sentry, Jun–Jul 2026). The per-country map
// is total over CountryCode, so a recipient always resolves.
const PayloadSchema = z.object({
    to: z.string().optional(),
    policyId: z.string().min(1),
    policyNumber: z.string().optional(),
    quoteReference: z.string().optional(),
    reasons: z.array(z.string()).optional().default([]),
});

// Canonical envelope producers nest the payload under `data`.
const EnvelopeSchema = z.object({ data: PayloadSchema });

function extractPayload(jobData: unknown): z.infer<typeof PayloadSchema> {
    // Legacy flat shape carries policyId at the top level; otherwise the
    // job data must be a canonical envelope with the payload under `data`.
    const flat = PayloadSchema.safeParse(jobData);
    if (flat.success) return flat.data;
    return EnvelopeSchema.parse(jobData).data;
}

export const handleEmailUwReferral: JobHandler = async (job: Job) => {
    const data = extractPayload(job.data);
    // Bind the policy's operating tenant so recipient resolution and the
    // communications spine (tenant-scoped Prisma) run in the right context.
    await runWithPolicyOperatingTenant(data.policyId, async () => {
        const explicitTo = String(data.to || '').trim();
        const recipients = explicitTo
            ? [explicitTo]
            : [...uwReferralEmailsForCountry(getTenantConfig().countryCode)];
        const policyNumber = data.policyNumber ?? data.quoteReference ?? data.policyId;
        const adminUrl = buildBackOfficePolicyUrl(
            resolvePublicAppBaseUrlFromTenant(),
            data.policyId,
            { tab: 'underwriting' },
        );

        // Dedicated internal template (UW_REFERRAL_NOTIFICATION). The previous
        // vehicle, customer-facing UW_INFO_REQUEST, requires a `uw.url`
        // secure-capture link that referral producers cannot supply — so the
        // dispatch was silently skipped on missing required variables and no
        // referral email ever reached the underwriting team.
        const reasonsText = data.reasons.length
            ? data.reasons.map((reason) => `- ${reason}`).join('\n')
            : '- No trigger fields captured';

        for (const to of recipients) {
            const result = await dispatchCustomerEmailTrigger({
                trigger: 'UW_REFERRAL_RAISED',
                entityType: 'POLICY',
                entityId: data.policyId,
                toEmail: to,
                variables: {
                    policy: { number: policyNumber },
                    uw: { adminUrl, message: `Referral reasons:\n${reasonsText}` },
                },
                idempotencySeed: `${policyNumber}:${data.reasons.join('|')}`,
                forceSystemOnly: true,
            });
            if (result.skipped) {
                // A skipped referral notification is the exact failure mode that
                // left underwriters blind — fail the job so it retries and alerts.
                throw new Error(`EMAIL.UW_REFERRAL: dispatch skipped for ${to}: ${result.reason}`);
            }
            logger.info({ to, policyNumber, skipped: result.skipped }, 'email.uw_referral.dispatched');
        }
    });
};

registerHandler('EMAIL.UW_REFERRAL', handleEmailUwReferral);
