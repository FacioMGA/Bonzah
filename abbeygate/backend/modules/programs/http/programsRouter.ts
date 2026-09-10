import { Router, type NextFunction, type Request } from 'express';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';

import { getOrInitProgramMbeProductConfig, saveProgramMbeProductConfig } from '../app/mbeInterop.js';
import { getFirstProductRatingMatrixSnapshot } from '../app/mbeInterop.js';
import { assertBinderAuthorizesProduct, BinderAuthorityError } from '../../policy/app/binders/binderAuthority.js';

import { logger } from '../../../platform/utils/logger.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';
const router = Router();

function programsAuditLog(req: Request, _res: unknown, next: NextFunction): void {
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

const IdParamSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
});

const LinkParamsSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
  linkId: z.string().trim().min(1, 'linkId is required'),
});

const JsonRecordSchema = z.record(z.string(), z.unknown());

const ProgramCreateBodySchema = z.object({
  name: z.string().trim().min(1),
  productType: z.string().trim().min(1).max(64).transform((value) => value.toUpperCase()),
  metadata: JsonRecordSchema.optional(),
});

const UwConfigBodySchema = JsonRecordSchema;

const ProgramRatingModelBodySchema = z.object({
  stages: z.array(z.unknown()).min(1, 'stages are required'),
  tables: JsonRecordSchema,
  source: z.string().optional(),
  name: z.string().optional(),
  notes: z.string().optional(),
});

const ProgramBinderCreateBodySchema = z.object({
  binderId: z.string().trim().min(1, 'binderId is required'),
  status: z.string().trim().optional(),
  mapping: JsonRecordSchema.optional(),
});

async function resolveBinderByIdOrCode(input: string) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const byId = await tenantScopedPrisma.binder.findUnique({
    where: { id: raw },
    select: { id: true, agreementNumber: true, umr: true },
  });
  if (byId) return byId;
  const byCode = await tenantScopedPrisma.binder.findFirst({
    where: {
      OR: [{ agreementNumber: raw }, { umr: raw }],
    },
    select: { id: true, agreementNumber: true, umr: true },
  });
  return byCode;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) {
    throw new Error('Invalid JSON payload: top-level value cannot be null/undefined');
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry === null) return null;
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
        throw new Error('Invalid JSON payload: non-serializable array value');
      }
      return toInputJson(entry);
    });
  }
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
        throw new Error(`Invalid JSON payload at key '${key}': non-serializable value`);
      }
      out[key] = entry === null ? null : toInputJson(entry);
    }
    return out;
  }
  throw new Error('Invalid JSON payload: non-serializable value');
}

function ensureProgramModelAvailable(res: Response): boolean {
  // If Prisma client wasn't regenerated after schema changes, `tenantScopedPrisma.program` can be undefined at runtime.
  const has = Boolean(tenantScopedPrisma.program);
  if (!has) {
    res.status(500).json({
      success: false,
      error: {
        code: 'PRISMA_CLIENT_OUT_OF_DATE',
        message: 'Program model is not available in Prisma client. Run `npx prisma db push` (or migrate) and restart the API server.',
      },
    });
    return false;
  }
  return true;
}

type ProgramRatingModelPayload = {
  stages: unknown[];
  tables: Record<string, unknown>;
  source?: string;
  name?: string;
  notes?: string;
};

// --- Programs CRUD (DB-backed) ---
// NOTE: Keep non-parameter routes above `/:id/...` routes.
router.get('/', async (_req, res) => {
  try {
    if (!ensureProgramModelAvailable(res)) return;
    const programs = await tenantScopedPrisma.program.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { binderLinks: { include: { binder: true } } }
    });
    return res.json({ success: true, data: programs });
  } catch (err: unknown) {
    logger.error({ err: err }, 'Failed to list programs:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to list programs') } });
  }
});

router.post('/', requirePermission('programs', 'create'), programsAuditLog, async (req, res) => {
  try {
    if (!ensureProgramModelAvailable(res)) return;
    const body = ProgramCreateBodySchema.parse(req.body);
    const productDefinition = await prisma.productDefinition.findUnique({
      where: { code: body.productType },
      select: { code: true, isActive: true },
    });
    if (!productDefinition || !productDefinition.isActive) {
      return res.status(422).json({
        success: false,
        error: { code: 'PRODUCT_NOT_AVAILABLE', message: `No active product definition for ${body.productType}` },
      });
    }
    const created = await tenantScopedPrisma.program.create({
      data: {
        name: body.name,
        productType: productDefinition.code,
        status: 'DRAFT',
        metadata: toInputJson(body.metadata ?? {}),
      } as unknown as Prisma.ProgramUncheckedCreateInput,
    });
    // Best-effort audit
    const ctx = getAuditContext(req);
    await AuditLogger.log(
      created.id,
      'PROGRAM',
      'PROGRAM.CREATED',
      ctx.actorId || 'system',
      ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
      { name: created.name, productType: created.productType, status: created.status }
    );
    return res.json({ success: true, data: created });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid request body' } });
    }
    logger.error({ err: err }, 'Failed to create program:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to create program') } });
  }
});

// GET /api/programs/:id/uw-config
// Returns the Abbeygate Motor UW config stored under program.metadata.abbeygateMotorUwConfig (or {} if none).
router.get('/:id/uw-config', async (req, res) => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id }, select: { id: true, metadata: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    const metadataParsed = JsonRecordSchema.safeParse(program.metadata);
    const metadata = metadataParsed.success ? metadataParsed.data : {};
    const uwConfigParsed = JsonRecordSchema.safeParse(metadata.abbeygateMotorUwConfig);
    return res.json({ success: true, data: uwConfigParsed.success ? uwConfigParsed.data : {} });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid program id' } });
    }
    logger.error({ err: err }, 'Failed to get uw-config:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to get uw-config') } });
  }
});

// PUT /api/programs/:id/uw-config
// Upserts the Abbeygate Motor UW config under program.metadata.abbeygateMotorUwConfig.
router.put('/:id/uw-config', programsAuditLog, async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    const cfg = UwConfigBodySchema.parse(req.body);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true, metadata: true, name: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });

    const metadataParsed = JsonRecordSchema.safeParse(program.metadata);
    const nextMeta: Record<string, unknown> = { ...(metadataParsed.success ? metadataParsed.data : {}) };
    nextMeta.abbeygateMotorUwConfig = cfg;

    const updated = await tenantScopedPrisma.program.update({
      where: { id: programId },
      data: { metadata: toInputJson(nextMeta) },
    });

    const ctx = getAuditContext(req);
    await AuditLogger.log(
      programId,
      'PROGRAM',
      'PROGRAM.UW_CONFIG.SAVED',
      ctx.actorId || 'system',
      ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
      { programName: program.name, keys: Object.keys(cfg || {}) }
    );

    const updatedMetaParsed = JsonRecordSchema.safeParse(updated.metadata);
    const updatedUwConfigParsed = JsonRecordSchema.safeParse(
      updatedMetaParsed.success ? updatedMetaParsed.data.abbeygateMotorUwConfig : undefined
    );
    return res.json({ success: true, data: updatedUwConfigParsed.success ? updatedUwConfigParsed.data : {} });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid request' } });
    }
    logger.error({ err: err }, 'Failed to save uw-config:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to save uw-config') } });
  }
});

// GET /api/programs/:id/mbe-config
// Returns the MagicB Endorsements product configuration stored under program.metadata.mbeProductConfig.
router.get('/:id/mbe-config', async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;
    const cfg = await getOrInitProgramMbeProductConfig(programId);
    return res.json({ success: true, data: cfg });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid program id' } });
    }
    logger.error({ err: err }, 'Failed to get mbe-config:');
    const msg = errorMessage(err, 'Failed to get mbe-config');
    const code = msg.includes('not found') ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR';
    return res.status(code === 'NOT_FOUND' ? 404 : 500).json({ success: false, error: { code, message: msg } });
  }
});

// PUT /api/programs/:id/mbe-config
// Upserts the MagicB Endorsements product configuration under program.metadata.mbeProductConfig.
router.put('/:id/mbe-config', programsAuditLog, async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    const payload = JsonRecordSchema.parse(req.body);
    if (!ensureProgramModelAvailable(res)) return;
    const saved = await saveProgramMbeProductConfig(programId, payload);

    const ctx = getAuditContext(req);
    const savedParsed = JsonRecordSchema.safeParse(saved);
    const schemaVersion = savedParsed.success && typeof savedParsed.data.schemaVersion === 'string' ? savedParsed.data.schemaVersion : undefined;
    const programCode = savedParsed.success && typeof savedParsed.data.programCode === 'string' ? savedParsed.data.programCode : undefined;
    await AuditLogger.log(
      programId,
      'PROGRAM',
      'PROGRAM.MBE_CONFIG.SAVED',
      ctx.actorId || 'system',
      ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
      { schemaVersion, programCode }
    );

    return res.json({ success: true, data: saved });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid request' } });
    }
    logger.error({ err: err }, 'Failed to save mbe-config:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to save mbe-config') } });
  }
});

// GET /api/programs/:id/rating-matrix
// Returns the product rating matrix via the registered product adapter.
router.get('/:id/rating-matrix', async (req, res) => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id }, select: { id: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    const matrix = await getFirstProductRatingMatrixSnapshot();
    return res.json({ success: true, data: matrix });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid program id' } });
    }
    logger.error({ err: err }, 'Failed to load rating matrix:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to load rating matrix') } });
  }
});

// GET /api/programs/:id/rating-model
// Returns latest ACTIVE model if exists, else latest DRAFT, else 404.
router.get('/:id/rating-model', async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    const active = await tenantScopedPrisma.programRatingModel.findFirst({
      where: { programId, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    if (active) return res.json({ success: true, data: active });

    const draft = await tenantScopedPrisma.programRatingModel.findFirst({
      where: { programId, status: 'DRAFT' },
      orderBy: { version: 'desc' },
    });
    if (draft) return res.json({ success: true, data: draft });

    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No rating model found' } });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid program id' } });
    }
    logger.error({ err: err }, 'Failed to load rating model:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to load rating model') } });
  }
});

// PUT /api/programs/:id/rating-model
// Upserts a DRAFT model (creates next version if none exists).
router.put('/:id/rating-model', programsAuditLog, async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    const body = ProgramRatingModelBodySchema.parse(req.body) as ProgramRatingModelPayload;
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });

    const existingDraft = await tenantScopedPrisma.programRatingModel.findFirst({
      where: { programId, status: 'DRAFT' },
      orderBy: { version: 'desc' },
    });

    if (existingDraft) {
      const updated = await tenantScopedPrisma.programRatingModel.update({
        where: { id: existingDraft.id },
        data: {
          stages: toInputJson(body.stages),
          tables: toInputJson(body.tables),
          source: body.source,
          name: body.name,
          notes: body.notes,
        },
      });
      const ctx = getAuditContext(req);
      await AuditLogger.log(
        programId,
        'PROGRAM',
        'PROGRAM.RATING_MODEL.SAVED',
        ctx.actorId || 'system',
        ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
        { ratingModelId: updated.id, version: updated.version, status: updated.status }
      );
      return res.json({ success: true, data: updated });
    }

    const max = await tenantScopedPrisma.programRatingModel.findFirst({
      where: { programId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (max?.version || 0) + 1;

    const created = await tenantScopedPrisma.programRatingModel.create({
      data: {
        programId,
        version,
        status: 'DRAFT',
        stages: toInputJson(body.stages),
        tables: toInputJson(body.tables),
        source: body.source,
        name: body.name,
        notes: body.notes,
      } as unknown as Prisma.ProgramRatingModelUncheckedCreateInput,
    });
    const ctx = getAuditContext(req);
    await AuditLogger.log(
      programId,
      'PROGRAM',
      'PROGRAM.RATING_MODEL.SAVED',
      ctx.actorId || 'system',
      ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
      { ratingModelId: created.id, version: created.version, status: created.status }
    );
    return res.json({ success: true, data: created });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid request body' } });
    }
    logger.error({ err: err }, 'Failed to save rating model:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to save rating model') } });
  }
});

// POST /api/programs/:id/rating-model/publish
// Promotes latest DRAFT to ACTIVE and archives any existing ACTIVE.
router.post('/:id/rating-model/publish', programsAuditLog, async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    const draft = await tenantScopedPrisma.programRatingModel.findFirst({
      where: { programId, status: 'DRAFT' },
      orderBy: { version: 'desc' },
    });
    if (!draft) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No draft to publish' } });

    await tenantScopedPrisma.programRatingModel.updateMany({
      where: { programId, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' },
    });

    const active = await tenantScopedPrisma.programRatingModel.update({
      where: { id: draft.id },
      data: { status: 'ACTIVE' },
    });

    const ctx = getAuditContext(req);
    await AuditLogger.log(
      programId,
      'PROGRAM',
      'PROGRAM.RATING_MODEL.PUBLISHED',
      ctx.actorId || 'system',
      ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
      { ratingModelId: active.id, version: active.version, status: active.status }
    );
    return res.json({ success: true, data: active });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid program id' } });
    }
    logger.error({ err: err }, 'Failed to publish rating model:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to publish rating model') } });
  }
});

// --- Program ↔ Binder links (many-to-many) ---

// GET /api/programs/:id/binders
router.get('/:id/binders', programsAuditLog, async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;

    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });

    const links = await prisma.programBinderLink.findMany({
      where: { programId },
      include: { binder: true },
      orderBy: { updatedAt: 'desc' },
    });
    return res.json({ success: true, data: links });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid program id' } });
    }
    logger.error({ err: err }, 'Failed to list program binders:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to list program binders') } });
  }
});

// POST /api/programs/:id/binders
// Body: { binderId, status?, mapping? }
router.post('/:id/binders', programsAuditLog, async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    const { binderId, status, mapping } = ProgramBinderCreateBodySchema.parse(req.body);
    if (!ensureProgramModelAvailable(res)) return;

    const [program, binder] = await Promise.all([
      tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true, name: true, productType: true } }),
      resolveBinderByIdOrCode(String(binderId)),
    ]);
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    if (!binder) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Binder not found' } });

    // Lloyd's-grade: linking a program to a binder implicitly means the binder must
    // authorize that program's product. In non-strict mode this logs a warning and
    // allows the link (so backfill + rollout can proceed); in strict mode it rejects.
    const programProductCode = String(program.productType || '').trim().toUpperCase();
    if (programProductCode) {
      try {
        await assertBinderAuthorizesProduct({ binderId: String(binder.id), productCode: programProductCode });
      } catch (err) {
        if (err instanceof BinderAuthorityError) {
          return res.status(422).json({
            success: false,
            error: { code: err.code, message: err.message, reason: err.reason },
          });
        }
        throw err;
      }
    }

    const created = await prisma.programBinderLink.create({
      data: {
        programId,
        binderId: String(binder.id),
        status: String(status || 'ACTIVE'),
        mapping: toInputJson(mapping ?? {}),
      },
    });

    const ctx = getAuditContext(req);
    await AuditLogger.log(
      programId,
      'PROGRAM',
      'PROGRAM.BINDER_LINK.CREATED',
      ctx.actorId || 'system',
      ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
      { binderId: String(binder.id), agreementNumber: binder.agreementNumber, umr: binder.umr }
    );

    return res.json({ success: true, data: created });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid request' } });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'This binder is already linked to the program.' },
      });
    }
    logger.error({ err: err }, 'Failed to create program binder link:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to create program binder link') } });
  }
});

// DELETE /api/programs/:id/binders/:linkId
router.delete('/:id/binders/:linkId', programsAuditLog, async (req, res) => {
  try {
    const { id: programId, linkId } = LinkParamsSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;

    const existing = await prisma.programBinderLink.findUnique({ where: { id: linkId } });
    if (!existing || existing.programId !== programId) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Link not found' } });
    }

    await prisma.programBinderLink.delete({ where: { id: linkId } });

    const ctx = getAuditContext(req);
    await AuditLogger.log(
      programId,
      'PROGRAM',
      'PROGRAM.BINDER_LINK.DELETED',
      ctx.actorId || 'system',
      ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
      { binderId: existing.binderId, linkId }
    );

    return res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid request params' } });
    }
    logger.error({ err: err }, 'Failed to delete program binder link:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to delete program binder link') } });
  }
});

// GET /api/programs/:id - must be last to avoid swallowing `/rating-*` routes.
router.get('/:id', async (req, res) => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    return res.json({ success: true, data: program });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid program id' } });
    }
    logger.error({ err: err }, 'Failed to get program:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to get program') } });
  }
});

export default router;

