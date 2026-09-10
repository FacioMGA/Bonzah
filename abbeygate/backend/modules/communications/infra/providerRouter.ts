import type { DeliveryResult } from '../domain/types.js';
import { sendEmail } from './adapters/emailAdapter.js';
import { sendSms, sendWhatsapp } from './adapters/twilioAdapter.js';
import { logger } from '../../../platform/utils/logger.js';

interface MessagePayload {
    id: string;
    channel: string;
    provider: string;
    fromActor: string;
    toRecipients: unknown;
    subject: string | null;
    body: string;
    attachments?: unknown;
    externalRefs?: unknown;
}

/**
 * ProviderRouter — routes a message to the correct delivery adapter based on channel.
 *
 * For now, only EMAIL is fully implemented. SMS and WhatsApp return graceful
 * "not configured" failures until provider integrations are built.
 */
export class ProviderRouter {
    static async deliver(message: MessagePayload): Promise<DeliveryResult> {
        const channel = (message.channel || '').toUpperCase();

        switch (channel) {
            case 'EMAIL':
                return sendEmail(message);

            case 'SMS':
                return sendSms(message);

            case 'WHATSAPP':
                return sendWhatsapp(message);

            case 'NOTE':
            case 'SYSTEM':
            case 'INTERNAL_CHAT':
                // Internal channels are logged, not delivered
                return {
                    status: 'DELIVERED',
                    deliveredAt: new Date(),
                };

            default:
                logger.warn({ event: 'comms.channel.unknown', messageId: message.id, channel }, 'comms.channel.unknown');
                return {
                    status: 'FAILED',
                    errorCode: 'UNKNOWN_CHANNEL',
                    errorDetail: `Unknown channel: ${channel}`,
                };
        }
    }
}
