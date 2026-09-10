import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { CreateUpdateBinderSchema } from '../../../platform/types/binderTypes.js';
import { createBinderUseCase } from '../app/binders/createBinder.js';
import { getBinderByIdUseCase } from '../app/binders/getBinderById.js';
import { getBinderUsageUseCase } from '../app/binders/getBinderUsage.js';
import { listBindersUseCase } from '../app/binders/listBinders.js';
import { publishBinderUseCase } from '../app/binders/publishBinder.js';
import { simulateBinderCheckUseCase } from '../app/binders/simulateBinderCheck.js';
import { uploadBinderAgreementUseCase } from '../app/binders/uploadBinderAgreement.js';
import { updateBinderUseCase } from '../app/binders/updateBinder.js';
import {
    buildCreateBinderDeps,
    buildListBindersDeps,
    buildGetBinderByIdDeps,
    buildGetBinderUsageDeps,
    buildPublishBinderDeps,
    buildSimulateBinderCheckDeps,
    buildUploadBinderAgreementDeps,
    buildUpdateBinderDeps,
} from './bindersRouter.adapters.js';
import { logger } from '../../../platform/utils/logger.js';
import { createRestrictedMemoryUpload } from '../../../platform/security/uploadPolicy.js';
import { getClientIpForRateLimit, readRateLimitInt } from '../../../platform/http/middleware/rateLimit.js';
import {
    BinderProductAuthorityCreateSchema,
    BinderProductAuthorityError,
    BinderProductAuthorityUpdateSchema,
    listBinderProductAuthorities,
    readBinderProductAuthority,
    updateBinderProductAuthority,
    upsertBinderProductAuthority,
} from '../app/binders/productAuthority.js';

const router = Router();
const binderAuthorityWriteLimiter = rateLimit({
    windowMs: readRateLimitInt('RATE_LIMIT_BINDER_AUTHORITY_WINDOW_MS', 15 * 60 * 1000),
    max: readRateLimitInt('RATE_LIMIT_BINDER_AUTHORITY_MAX', 60),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const tenantId = String(req.headers['x-tenant-id'] || '').trim() || 'no-tenant';
        const actorId = String(req.user?.id || '').trim() || 'no-user';
        return `binder-authority:${tenantId}:${actorId}:${getClientIpForRateLimit(req)}`;
    },
});
const upload = createRestrictedMemoryUpload({
    maxFileSizeBytes: 15 * 1024 * 1024,
    allowedMimeTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png',
        'image/jpeg',
        'image/webp',
    ],
    allowedExtensions: ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.webp'],
});

function bindersAuditLog(req: Request, _res: Response, next: NextFunction): void {
    try {
        const correlationId = (req.headers['x-correlation-id'] as string) || req.correlationId;
        const actionId = req.headers['x-action-id'] as string;
        const tenantId = String(req.headers['x-tenant-id'] || '').trim() || undefined;
        const textUser = req.user;
        const actorId = textUser?.id || 'system';
        const actorType = textUser?.role || 'SYSTEM';
        req.auditContext = { correlationId, actionId, tenantId, actorId, actorType };
        next();
    } catch {
        next();
    }
}

function getAuditContext(req: Request): { actorId?: string; actorType?: string } {
    return req.auditContext || {};
}

const BinderSimulationSchema = z.object({
    territory: z.string().trim().optional(),
    riskLocationCountry: z.string().trim().optional(),
    insuredDomicileCountry: z.string().trim().optional(),
    vehicleValue: z.coerce.number().optional(),
}).passthrough();

// GET /api/binders - List all binders
router.get('/', bindersAuditLog, async (_req, res) => {
    try {
        const result = await listBindersUseCase(buildListBindersDeps());
        return res.status(result.status).json(result.body);
    } catch (error) {
        logger.error({ err: error }, 'Error listing binders:');
        return res.status(500).json({ success: false, error: 'Failed to list binders' });
    }
});

// POST /api/binders - Create a binder manually (optional)
router.post('/', requirePermission('binders', 'create'), bindersAuditLog, async (req, res) => {
    try {
        const parsed = CreateUpdateBinderSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Invalid binder payload' },
                details: parsed.error.flatten(),
            });
        }
        const ctx = getAuditContext(req);
        const result = await createBinderUseCase(
            {
                payload: parsed.data as Record<string, unknown>,
                actor: {
                    actorId: ctx.actorId || 'system',
                    actorType: ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
                },
            },
            buildCreateBinderDeps()
        );
        return res.status(result.status).json(result.body);
    } catch (error) {
        logger.error({ err: error }, 'Error creating binder:');
        return res.status(500).json({ success: false, error: 'Failed to create binder' });
    }
});

// GET /api/binders/:id - Binder detail (includes config and normalized children)
router.get('/:id', bindersAuditLog, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await getBinderByIdUseCase(
            { binderId: id },
            buildGetBinderByIdDeps()
        );
        return res.status(result.status).json(result.body);
    } catch (error) {
        logger.error({ err: error }, 'Error getting binder:');
        const message = error instanceof Error ? error.message : 'Failed to get binder';
        return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message } });
    }
});

// GET /api/binders/:id/usage - which programs reference this binder
router.get('/:id/usage', bindersAuditLog, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await getBinderUsageUseCase(
            { binderId: id },
            buildGetBinderUsageDeps()
        );
        return res.status(result.status).json(result.body);
    } catch (error) {
        logger.error({ err: error }, 'Error getting binder usage:');
        const message = error instanceof Error ? error.message : 'Failed to get binder usage';
        return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message } });
    }
});

// POST /api/binders/:id/simulate-check - lightweight authority simulation (no policy creation)
router.post('/:id/simulate-check', requirePermission('binders', 'view'), bindersAuditLog, async (req, res) => {
    try {
        const { id } = req.params;
        const parsed = BinderSimulationSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Invalid simulation payload' },
                details: parsed.error.flatten(),
            });
        }
        const result = await simulateBinderCheckUseCase(
            { binderId: id, payload: parsed.data },
            buildSimulateBinderCheckDeps()
        );
        return res.status(result.status).json(result.body);
    } catch (error) {
        logger.error({ err: error }, 'Error simulating binder check:');
        const message = error instanceof Error ? error.message : 'Failed to simulate binder check';
        return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message } });
    }
});

// PUT /api/binders/:id - Update binder config + scalars (sync config -> normalized tables)
router.put('/:id', requirePermission('binders', 'edit'), bindersAuditLog, async (req, res) => {
    try {
        const { id } = req.params;
        const parsed = CreateUpdateBinderSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Invalid binder payload' },
                details: parsed.error.flatten(),
            });
        }
        const ctx = getAuditContext(req);
        const result = await updateBinderUseCase(
            {
                binderId: id,
                payload: parsed.data as Record<string, unknown>,
                actor: {
                    actorId: ctx.actorId || 'system',
                    actorType: ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
                },
            },
            buildUpdateBinderDeps()
        );
        return res.status(result.status).json(result.body);
    } catch (error) {
        logger.error({ err: error }, 'Error updating binder:');
        const message = error instanceof Error ? error.message : 'Failed to update binder';
        return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message } });
    }
});

// POST /api/binders/upload - Actual Analysis (PDF + OCR Fallback for Images)
router.post('/upload', requirePermission('binders', 'create'), bindersAuditLog, upload.single('file'), async (req, res) => {
    try {
        const ctx = getAuditContext(req);
        const result = await uploadBinderAgreementUseCase(
            {
                file: req.file ? {
                    originalname: req.file.originalname,
                    mimetype: req.file.mimetype,
                    size: req.file.size,
                    buffer: req.file.buffer,
                } : null,
                actor: {
                    actorId: ctx.actorId || 'system',
                    actorType: ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
                },
                env: {
                    nodeEnv: process.env.NODE_ENV,
                    embeddingsProvider: process.env.EMBEDDINGS_PROVIDER || null,
                },
            },
            buildUploadBinderAgreementDeps()
        );
        return res.status(result.status).json(result.body);

    } catch (error) {
        logger.error({ err: error }, '❌ [Binder Upload] Critical Error:');
        return res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Unknown Server Error',
                details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined
            }
        });
    }
});

// NOTE: Intentionally no bulk-delete endpoint in production routes.

// POST /api/binders/:id/publish - Activate binder and initialize data layer
router.post('/:id/publish', requirePermission('binders', 'publish'), bindersAuditLog, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await publishBinderUseCase(
            { binderId: id },
            buildPublishBinderDeps()
        );
        return res.status(result.status).json(result.body);

    } catch (error) {
        logger.error({ err: error }, 'Error publishing binder:');
        return res.status(500).json({ success: false, error: 'Failed to publish binder' });
    }
});

// ── Binder Product Authorities ─────────────────────────────────────────────
// Lloyd's-grade per-product authorization on a binder. Every product a binder
// underwrites has one row here with its class-of-business, risk code, and
// authority limits. A policy cannot bind against a binder for a product that
// has no ACTIVE authority row (enforced by `assertBinderAuthorizesProduct`).

function authorityBadRequestMessage(err: unknown): string | null {
    if (err instanceof BinderProductAuthorityError) return err.message;
    if (err instanceof z.ZodError) return err.issues[0]?.message || 'Invalid payload';
    return null;
}

// GET /api/binders/:id/authorities — list all authorities for a binder
router.get('/:id/authorities', bindersAuditLog, async (req, res) => {
    try {
        const rows = await listBinderProductAuthorities(req.params.id);
        return res.json({ success: true, data: rows });
    } catch (err) {
        logger.error({ err }, 'binder.authorities.list.error');
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to list authorities' } });
    }
});

// POST /api/binders/:id/authorities — create a new authority
router.post('/:id/authorities', requirePermission('binders', 'edit'), binderAuthorityWriteLimiter, bindersAuditLog, async (req, res) => {
    try {
        const parsed = BinderProductAuthorityCreateSchema.parse({ ...req.body, binderId: req.params.id });
        if (await readBinderProductAuthority(parsed.binderId, parsed.productCode)) {
            return res.status(409).json({ success: false, error: { code: 'AUTHORITY_EXISTS', message: 'Binder product authority already exists.' } });
        }
        const created = await upsertBinderProductAuthority(parsed);
        return res.status(201).json({ success: true, data: created.authority });
    } catch (err) {
        const badRequestMessage = authorityBadRequestMessage(err);
        if (badRequestMessage) {
            return res.status(400).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: badRequestMessage },
            });
        }
        logger.error({ err }, 'binder.authority.create.error');
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to create authority' } });
    }
});

// PATCH /api/binders/:id/authorities/:productCode — update an authority
router.patch('/:id/authorities/:productCode', requirePermission('binders', 'edit'), binderAuthorityWriteLimiter, bindersAuditLog, async (req, res) => {
    try {
        const productCode = req.params.productCode.toUpperCase();
        const parsed = BinderProductAuthorityUpdateSchema.parse({ ...req.body, binderId: req.params.id, productCode });
        const updated = await updateBinderProductAuthority(parsed);
        return res.json({ success: true, data: updated });
    } catch (err) {
        const badRequestMessage = authorityBadRequestMessage(err);
        if (badRequestMessage) {
            return res.status(400).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: badRequestMessage },
            });
        }
        logger.error({ err }, 'binder.authority.update.error');
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to update authority' } });
    }
});

export default router;
