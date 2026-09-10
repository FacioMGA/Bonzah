
import { EmailPort, type EmailPortSendOptions } from '../interfaces.js';

import { logger } from '../../utils/logger.js';

type EmailVariables = Parameters<EmailPort['send']>[2];

export class InMemoryEmailAdapter implements EmailPort {
    public sentEmails: Array<{ messageId: string; to: string; templateId: string; variables: EmailVariables; options?: EmailPortSendOptions; timestamp: Date }> = [];

    async send(to: string, templateId: string, variables: EmailVariables, options?: EmailPortSendOptions): Promise<string> {
        const messageId = `mock-${Date.now()}`;
        this.sentEmails.push({ messageId, to, templateId, variables, options, timestamp: new Date() });
        logger.info(`[InMemoryEmail] Simulated send to ${to} (Template: ${templateId})`);
        return messageId;
    }
}
