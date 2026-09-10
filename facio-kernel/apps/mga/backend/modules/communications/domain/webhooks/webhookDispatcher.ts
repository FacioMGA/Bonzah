import crypto from 'crypto';
import { logger } from '../../../../platform/utils/logger.js';
import { safePostJson } from '../../../../platform/http/safeHttpClient.js';

type WebhookEndpoint = {
    url: string;
    secret: string;
};

/**
 * Service responsible for securely dispatching webhook payloads to registered third-party endpoints.
 */
export class WebhookDispatcher {
    /**
     * Dispatches an event to all active webhooks registered for a specific account.
     * Note: This method purposely does not `await` the external `fetch` calls to avoid blocking 
     * the critical path of the main server response. In a true enterprise environment, this 
     * would push the job to a queue (like SQS or BullMQ) for robust retry semantics.
     * 
     * @param endpoints - Active webhook endpoints for the account.
     * @param eventType - Business event identifier (e.g., 'claim.created', 'policy.bound').
     * @param payload - The core business entity JSON to send.
     */
    static async dispatch(endpoints: WebhookEndpoint[], eventType: string, payload: unknown): Promise<void> {
        try {
            if (endpoints.length === 0) return; // Nothing to sync

            const requestBody = JSON.stringify({
                eventId: crypto.randomUUID(),
                eventType,
                timestamp: new Date().toISOString(),
                data: payload
            });

            // Fire and forget requests safely
            endpoints.forEach(async (endpoint) => {
                try {
                    // Create cryptographic signature for payload authenticity
                    const hmac = crypto.createHmac('sha256', endpoint.secret);
                    hmac.update(requestBody);
                    const signature = hmac.digest('hex');

                    // Fire webhook asynchronously
                    await safePostJson(
                        endpoint.url,
                        {
                            'Content-Type': 'application/json',
                            'x-facio-signature': signature,
                            'x-facio-event': eventType,
                            'x-webhook-signature': signature,
                            'x-webhook-timestamp': String(Date.now()),
                            'User-Agent': 'FacioMGA-Webhook-Engine/1.0',
                        },
                        requestBody,
                        10000,
                    );

                    logger.info({ eventType, endpointUrl: endpoint.url }, 'Webhook dispatched successfully');
                } catch (dispatchErr) {
                    // In a production app, we would log this delivery failure and schedule a retry.
                    logger.error(
                        { err: dispatchErr, eventType, endpointUrl: endpoint.url },
                        'Webhook delivery failed'
                    );
                }
            });

        } catch (err) {
            logger.error({ err, eventType }, 'Webhook dispatcher global error');
        }
    }
}
