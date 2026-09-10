import { Request, Response, NextFunction } from 'express';
import { ApiKeyService } from '../../platform/auth/apiKeyService.js';
import { logger } from '../../platform/utils/logger.js';

type ApiAccount = NonNullable<Awaited<ReturnType<typeof ApiKeyService.validateKey>>>;
export type { ApiAccount };

export async function authenticateApiKey(req: Request, res: Response, next: NextFunction) {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
        logger.warn({ ip: req.ip, path: req.path }, 'Missing x-api-key header');
        return res.status(401).json({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Missing x-api-key header' },
        });
    }

    try {
        const account = await ApiKeyService.validateKey(apiKey);

        if (!account) {
            logger.warn({ ip: req.ip, path: req.path }, 'Invalid x-api-key provided');
            return res.status(401).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Invalid or expired API Key' },
            });
        }

        // Attach contextual account to the request for downward routes
        req.apiAccount = account;

        // Crucial for multi-tenancy: set the x-tenant-id so that RLS middleware
        // (setAccountScopeContext) automatically segments database rows for this Account.
        // If an integration wants to override `x-tenant-id` they're free to provided 
        // it belongs to their Account tree (logic to be verified in RLS directly).
        if (!req.headers['x-tenant-id']) {
            req.headers['x-tenant-id'] = account.id;
        }

        return next();
    } catch (err) {
        logger.error({ err }, 'Error during API Key verification');
        return res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to authenticate API key' },
        });
    }
}
