import { z } from 'zod';
import { sendPublicQuoteEmailForSession } from '../../modules/quotes/app/publicQuoteEmailService.js';
import { resolvePublicAppBaseUrlFromTenant } from '../../platform/http/publicAppLinks.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { logger } from '../../platform/utils/logger.js';
import { registerHandler } from '../index.js';

const PayloadSchema = z.object({
  policyId: z.string().min(1, 'EMAIL.PUBLIC_QUOTE missing policyId'),
  productCode: z.string().min(1, 'EMAIL.PUBLIC_QUOTE missing productCode'),
  source: z.enum(['rate', 'manual']).default('manual'),
});
const EnvelopeSchema = z.object({ data: PayloadSchema });
type PublicQuoteJob = { data: unknown };

function extractPayload(data: unknown): z.infer<typeof PayloadSchema> {
  const direct = PayloadSchema.safeParse(data);
  return direct.success ? direct.data : EnvelopeSchema.parse(data).data;
}

/** Durable public quote correspondence worker. */
export const handleEmailPublicQuote = async (job: PublicQuoteJob): Promise<void> => {
  const data = extractPayload(job.data);
  await runWithPolicyOperatingTenant(data.policyId, async () => {
    const { tenantScopedPrisma } = await import('../../platform/db/connection.js');
    const policy = await tenantScopedPrisma.policy.findUnique({
      where: { id: data.policyId },
      select: { publicSessionToken: true },
    });
    const token = String(policy?.publicSessionToken || '').trim();
    if (!token) throw new Error(`EMAIL.PUBLIC_QUOTE: policy ${data.policyId} has no public session token`);

    const result = await sendPublicQuoteEmailForSession({
      productCode: data.productCode,
      publicSessionToken: token,
      baseUrl: resolvePublicAppBaseUrlFromTenant(),
      source: data.source,
    });
    if (!result.ok || !result.queued) {
      throw new Error(`EMAIL.PUBLIC_QUOTE: dispatch failed for ${data.policyId}: ${result.ok ? result.skippedReason : result.message}`);
    }
    logger.info({ policyId: data.policyId, recipient: result.recipient, source: data.source }, 'email.public_quote.dispatched');
  });
};

registerHandler('EMAIL.PUBLIC_QUOTE', handleEmailPublicQuote);
