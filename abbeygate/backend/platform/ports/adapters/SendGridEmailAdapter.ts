
import { EmailPort, type EmailPortSendOptions } from '../interfaces.js';
import sgMail from '@sendgrid/mail';

import { logger } from '../../utils/logger.js';
export class SendGridEmailAdapter implements EmailPort {
    constructor(apiKey: string) {
        sgMail.setApiKey(apiKey);
    }

    async send(
        to: string,
        templateId: string,
        variables: Record<string, unknown>,
        options?: EmailPortSendOptions
    ): Promise<string> {
        const from = process.env.EMAIL_FROM_ADDRESS || 'no-reply@facio.io';
        const msg = {
            to,
            from,
            templateId,
            dynamicTemplateData: variables,
            customArgs: options?.customArgs,
            attachments: (options?.attachments || []).map((attachment) => ({
                filename: attachment.filename,
                content: attachment.contentBase64,
                type: attachment.mimetype || 'application/octet-stream',
                disposition: 'attachment',
            })),
        };

        try {
            const [response] = await sgMail.send(msg);
            const messageId = response.headers['x-message-id'];
            logger.info({ event: 'email.sendgrid.sent', to, messageId }, 'email.sendgrid.sent');
            return messageId;
        } catch (error: unknown) {
            logger.error({ event: 'email.sendgrid.failed', to, err: error }, 'email.sendgrid.failed');
            const errRecord = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
            const response = errRecord.response && typeof errRecord.response === 'object'
                ? (errRecord.response as Record<string, unknown>)
                : null;
            if (response?.body) {
                logger.error({ event: 'email.sendgrid.failed_body', to, responseBody: response.body }, 'email.sendgrid.failed_body');
            }
            throw error;
        }
    }
}
