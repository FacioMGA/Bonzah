import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { openApiRegistry, ErrorResponseSchema } from '../../../platform/openapi/openapi.js';
import crypto from 'crypto';
import { logger } from '../../../platform/utils/logger.js';

const router = Router();

// Zod schemas
const WebhookRequestSchema = openApiRegistry.register('WebhookRequest', z.object({
    url: z.string().url().describe('Secured HTTPS endpoint on your infrastructure where payload notifications will be delivered'),
    description: z.string().optional().describe('Human-readable label for this integration pathway').openapi({ example: "Primary System-of-Record Sync" }),
}));

const WebhookResponseSchema = openApiRegistry.register('WebhookResponse', z.object({
    id: z.string().uuid(),
    url: z.string().url(),
    description: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string().datetime(),
}));

const WebhookCreatedSchema = openApiRegistry.register('WebhookCreatedResponse', WebhookResponseSchema.extend({
    secret: z.string().describe('CRITICAL: Vault this cryptographic Secret. Use it to cryptographically verify (via HMAC) that incoming payloads authentically originated from FacioMGA. IT WILL NEVER BE SHOWN AGAIN.'),
}));

openApiRegistry.registerPath({
    method: 'post',
    path: '/v1/webhooks/endpoints',
    operationId: 'registerWebhook',
    summary: 'Register Sync Endpoint',
    description: 'Registers a secure HTTPS listener to receive asynchronous push notifications from our engine (e.g., when a Policy is legally bound or a Claim advances through settlement).',
    tags: ['6. Webhooks'],
    request: {
        body: {
            content: { 'application/json': { schema: WebhookRequestSchema } },
        },
    },
    responses: {
        201: {
            description: 'Webhook successfully registered',
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: WebhookCreatedSchema }) } },
        },
        400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: '/v1/webhooks/endpoints',
    operationId: 'listWebhooks',
    summary: 'List Registered Listeners',
    description: 'Retrieves all active operations synchronization endpoints bound to your organizational tier.',
    tags: ['6. Webhooks'],
    responses: {
        200: {
            description: 'Successful retrieval of webhooks',
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.array(WebhookResponseSchema) }) } },
        },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    },
});

openApiRegistry.registerPath({
    method: 'delete',
    path: '/v1/webhooks/endpoints/{webhookId}',
    operationId: 'deleteWebhook',
    summary: 'Deactivate Sync Endpoint',
    description: 'Permanently removes a listener, ceasing all outbound synchronization traffic to that URL.',
    tags: ['6. Webhooks'],
    request: {
        params: z.object({ webhookId: z.string().uuid() }),
    },
    responses: {
        200: {
            description: 'Webhook successfully deleted',
            content: { 'application/json': { schema: z.object({ success: z.boolean(), message: z.string() }) } },
        },
        401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
        404: { description: 'Webhook not found or unauthorized', content: { 'application/json': { schema: ErrorResponseSchema } } },
    },
});

router.post('/endpoints', async (req, res) => {
    try {
        const parsed = WebhookRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ success: false, error: parsed.error.format() });
        }

        const requestAccount = req.apiAccount;
        if (!requestAccount) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

        // Generate a strong cryptographic secret for HMAC signing
        const secret = `whsec_${crypto.randomBytes(32).toString('hex')}`;

        const webhookData: Prisma.WebhookEndpointUncheckedCreateInput = {
            operatingTenantId: getTenantConfig().id,
            accountId: requestAccount.id,
            url: parsed.data.url,
            description: parsed.data.description,
            secret, // We store this securely; could be KMS enc in future, but simple store is OK for Phase 3.
        };
        const webhook = await tenantScopedPrisma.webhookEndpoint.create({ data: webhookData });

        return res.status(201).json({
            success: true,
            data: {
                id: webhook.id,
                url: webhook.url,
                description: webhook.description,
                isActive: webhook.isActive,
                createdAt: webhook.createdAt.toISOString(),
                secret, // Provided ONLY ONCE
            }
        });

    } catch (err) {
        logger.error({ err }, 'Error POST /v1/webhooks/endpoints');
        return res.status(500).json({ success: false, error: { message: 'Failed to create webhook endpoint' } });
    }
});

router.get('/endpoints', async (req, res) => {
    try {
        const requestAccount = req.apiAccount;
        if (!requestAccount) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

        const webhooks = await tenantScopedPrisma.webhookEndpoint.findMany({
            where: { accountId: requestAccount.id }
        });

        return res.json({
            success: true,
            data: webhooks.map((wh) => ({
                id: wh.id,
                url: wh.url,
                description: wh.description,
                isActive: wh.isActive,
                createdAt: wh.createdAt.toISOString(),
            }))
        });

    } catch (err) {
        logger.error({ err }, 'Error GET /v1/webhooks/endpoints');
        return res.status(500).json({ success: false, error: { message: 'Failed to retrieve webhooks' } });
    }
});

router.delete('/endpoints/:webhookId', async (req, res) => {
    try {
        const requestAccount = req.apiAccount;
        if (!requestAccount) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

        const { count } = await tenantScopedPrisma.webhookEndpoint.deleteMany({
            where: {
                id: req.params.webhookId,
                accountId: requestAccount.id
            }
        });

        if (count === 0) {
            return res.status(404).json({ success: false, error: { message: 'Webhook not found or unauthorized' } });
        }

        return res.json({ success: true, message: 'Webhook endpoint deleted' });

    } catch (err) {
        logger.error({ err }, 'Error DELETE /v1/webhooks/endpoints/:id');
        return res.status(500).json({ success: false, error: { message: 'Failed to delete webhook' } });
    }
});

export default router;
