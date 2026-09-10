import type { Prisma } from '@prisma/client';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { CreateUpdateBinderSchema } from '../../../platform/types/binderTypes.js';
import { createBinderUseCase } from '../app/binders/createBinder.js';
import { getBinderByIdUseCase } from '../app/binders/getBinderById.js';
import { getBinderUsageUseCase } from '../app/binders/getBinderUsage.js';
import { listBindersUseCase } from '../app/binders/listBinders.js';
import { publishBinderUseCase } from '../app/binders/publishBinder.js';
import { simulateBinderCheckUseCase } from '../app/binders/simulateBinderCheck.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
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

const router = Router();
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
router.post('/', bindersAuditLog, async (req, res) => {
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
router.post('/:id/simulate-check', bindersAuditLog, async (req, res) => {
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
router.put('/:id', bindersAuditLog, async (req, res) => {
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
router.post('/upload', bindersAuditLog, upload.single('file'), async (req, res) => {
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
router.post('/:id/publish', bindersAuditLog, async (req, res) => {
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

const AuthorityCreateSchema = z.object({
    productCode: z.string().trim().min(1).max(64),
    classOfBusiness: z.string().trim().min(1).max(64),
    riskCode: z.string().trim().max(16).optional(),
    territorialScope: z.array(z.string()).optional(),
    maxPremiumAnnual: z.number().nonnegative().optional(),
    maxPolicyPeriodDays: z.number().int().positive().optional(),
    maxAdvanceInceptionDays: z.number().int().nonnegative().optional(),
    authorityClasses: z.array(z.string()).optional(),
    effectiveFrom: z.string().datetime().optional(),
    effectiveTo: z.string().datetime().optional(),
    notes: z.string().trim().max(1000).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

const AuthorityUpdateSchema = AuthorityCreateSchema.partial();

// GET /api/binders/:id/authorities — list all authorities for a binder
router.get('/:id/authorities', bindersAuditLog, async (req, res) => {
    try {
        const rows = await tenantScopedPrisma.binderProductAuthority.findMany({
            where: { binderId: req.params.id },
            include: { productDefinition: { select: { code: true, displayName: true, icon: true } } },
            orderBy: [{ status: 'asc' }, { productCode: 'asc' }],
        });
        return res.json({ success: true, data: rows });
    } catch (err) {
        logger.error({ err }, 'binder.authorities.list.error');
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to list authorities' } });
    }
});

// POST /api/binders/:id/authorities — create a new authority
router.post('/:id/authorities', bindersAuditLog, async (req, res) => {
    try {
        const parsed = AuthorityCreateSchema.parse(req.body);
        const { prisma } = await import('../../../platform/db/connection.js');
        const product = await prisma.productDefinition.findUnique({ where: { code: parsed.productCode.toUpperCase() } });
        if (!product) {
            return res.status(404).json({ success: false, error: { code: 'PRODUCT_NOT_FOUND', message: `No product definition for ${parsed.productCode}` } });
        }
        const created = await tenantScopedPrisma.binderProductAuthority.create({
            data: {
                binderId: req.params.id,
                productCode: parsed.productCode.toUpperCase(),
                classOfBusiness: parsed.classOfBusiness,
                riskCode: parsed.riskCode,
                territorialScope: parsed.territorialScope ?? [],
                maxPremiumAnnual: parsed.maxPremiumAnnual ?? null,
                maxPolicyPeriodDays: parsed.maxPolicyPeriodDays ?? null,
                maxAdvanceInceptionDays: parsed.maxAdvanceInceptionDays ?? null,
                authorityClasses: parsed.authorityClasses ?? [],
                effectiveFrom: parsed.effectiveFrom ? new Date(parsed.effectiveFrom) : null,
                effectiveTo: parsed.effectiveTo ? new Date(parsed.effectiveTo) : null,
                notes: parsed.notes ?? null,
                status: parsed.status ?? 'ACTIVE',
            } as unknown as Prisma.BinderProductAuthorityUncheckedCreateInput,
        });
        return res.status(201).json({ success: true, data: created });
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid payload' } });
        }
        logger.error({ err }, 'binder.authority.create.error');
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to create authority' } });
    }
});

// PATCH /api/binders/:id/authorities/:productCode — update an authority
router.patch('/:id/authorities/:productCode', bindersAuditLog, async (req, res) => {
    try {
        const parsed = AuthorityUpdateSchema.parse(req.body);
        const productCode = req.params.productCode.toUpperCase();
        const updated = await tenantScopedPrisma.binderProductAuthority.update({
            where: { binderId_productCode: { binderId: req.params.id, productCode } },
            data: {
                ...(parsed.classOfBusiness !== undefined ? { classOfBusiness: parsed.classOfBusiness } : {}),
                ...(parsed.riskCode !== undefined ? { riskCode: parsed.riskCode } : {}),
                ...(parsed.territorialScope !== undefined ? { territorialScope: parsed.territorialScope } : {}),
                ...(parsed.maxPremiumAnnual !== undefined ? { maxPremiumAnnual: parsed.maxPremiumAnnual } : {}),
                ...(parsed.maxPolicyPeriodDays !== undefined ? { maxPolicyPeriodDays: parsed.maxPolicyPeriodDays } : {}),
                ...(parsed.maxAdvanceInceptionDays !== undefined ? { maxAdvanceInceptionDays: parsed.maxAdvanceInceptionDays } : {}),
                ...(parsed.authorityClasses !== undefined ? { authorityClasses: parsed.authorityClasses } : {}),
                ...(parsed.effectiveFrom !== undefined ? { effectiveFrom: parsed.effectiveFrom ? new Date(parsed.effectiveFrom) : null } : {}),
                ...(parsed.effectiveTo !== undefined ? { effectiveTo: parsed.effectiveTo ? new Date(parsed.effectiveTo) : null } : {}),
                ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
                ...(parsed.status !== undefined ? { status: parsed.status } : {}),
            },
        });
        return res.json({ success: true, data: updated });
    } catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid payload' } });
        }
        logger.error({ err }, 'binder.authority.update.error');
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to update authority' } });
    }
});

export default router;
