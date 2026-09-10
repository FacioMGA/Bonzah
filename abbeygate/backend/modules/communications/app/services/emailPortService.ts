import { type EmailPort } from '../../../../platform/ports/interfaces.js';
import { SendGridEmailAdapter } from '../../../../platform/ports/adapters/SendGridEmailAdapter.js';
import { InMemoryEmailAdapter } from '../../../../platform/ports/adapters/InMemoryEmailAdapter.js';
import { logger } from '../../../../platform/utils/logger.js';

class EmailPortService {
  private emailPort: EmailPort | null = null;

  public overrideEmailPort(adapter: EmailPort) {
    this.emailPort = adapter;
  }

  public getEmailPort(): EmailPort {
    if (this.emailPort) return this.emailPort;

    const apiKey = process.env.SENDGRID_API_KEY;
    if (apiKey) {
      this.emailPort = new SendGridEmailAdapter(apiKey);
    } else {
      const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
      const allowInProd = String(process.env.ALLOW_INMEMORY_EMAIL_IN_PROD || '').toLowerCase() === 'true';
      if (isProd && !allowInProd) {
        logger.error({ event: 'email.provider.misconfigured', provider: 'SENDGRID' }, 'email.provider.misconfigured');
        throw new Error('SENDGRID_API_KEY is required in production.');
      }
      logger.warn({ event: 'email.provider.fallback_inmemory' }, 'email.provider.fallback_inmemory');
      this.emailPort = new InMemoryEmailAdapter();
    }
    return this.emailPort;
  }
}

export const emailPortService = new EmailPortService();
