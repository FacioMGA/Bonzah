import { tenantScopedPrisma } from '../../../../platform/db/connection.js';
import { WebhookDispatcher as DomainWebhookDispatcher } from '../../domain/webhooks/webhookDispatcher.js';

export class WebhookDispatcher {
  static async dispatch(accountId: string, eventType: string, payload: unknown): Promise<void> {
    const endpoints = await tenantScopedPrisma.webhookEndpoint.findMany({
      where: { accountId, isActive: true },
      select: { url: true, secret: true },
    });
    await DomainWebhookDispatcher.dispatch(endpoints, eventType, payload);
  }
}
