import { publishProgrammeDefinition } from '../../insuranceConfiguration/app/publishProgrammeDefinition.js';
import { Router, type NextFunction, type Request } from 'express';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { prisma, tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import {
  getProgrammeDefinitionEditorDescriptor,
  ProgrammeDefinitionEditorUnavailableError,
  validateProgramDefinitionComponents,
  validateProgramRatingModel,
} from '../app/programRuntimeDefinitions.js';
import { resolveMappedProgramDefinition, ProgramDefinitionConfigurationError } from '../app/activeProgramDefinition.js';

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

const ProgramDefinitionParamsSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
  binderProductAuthorityId: z.string().trim().min(1, 'binder product authority id is required'),
});

const JsonRecordSchema = z.record(z.string(), z.unknown());

const ProgramCreateBodySchema = z.object({
  name: z.string().trim().min(1),
  productType: z.string().trim().min(1).max(64).transform((value) => value.toUpperCase()),
});

const ProgramUpdateBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
}).refine((value) => Boolean(value.name), 'name is required');

const ProgramRatingModelBodySchema = z.object({
  // Pipelines are product-owned: Motor requires its ordered operators at
  // publication, while Home, Travel and Health have no executable stages.
  // Publication dispatches to the relevant product validator.
  stages: z.array(z.unknown()),
  tables: JsonRecordSchema,
  source: z.string().optional(),
  name: z.string().optional(),
  notes: z.string().optional(),
});

const PublishProgramRatingModelBodySchema = z.object({
  binderProductAuthorityIds: z.array(z.string().trim().min(1)).min(1, 'at least one binder product authority is required'),
});

const ProgramDefinitionComponentsBodySchema = z.object({
  underwriting: JsonRecordSchema,
  coverage: JsonRecordSchema,
  questionnaire: JsonRecordSchema,
  workflow: JsonRecordSchema,
  channels: JsonRecordSchema,
  documents: JsonRecordSchema,
});

const ProgramDefinitionDraftBodySchema = ProgramDefinitionComponentsBodySchema.extend({
  pricingMode: z.enum(['AUTOMATED', 'MANUAL']),
  programRatingModelId: z.string().trim().min(1).nullable().optional(),
  source: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
});

const PublishProgramDefinitionBodySchema = z.object({
  expectedDefinitionHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  binderProductAuthorityIds: z.array(z.string().trim().min(1)).min(1, 'at least one binder product authority is required'),
});

const ProgramDefinitionIdParamsSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
  definitionId: z.string().trim().min(1, 'definition id is required'),
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

// A programme identity may be renamed, but programme behaviour is immutable
// once published and is edited only through a new versioned definition.
router.put('/:id', requirePermission('programs', 'edit'), programsAuditLog, async (req, res) => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    const body = ProgramUpdateBodySchema.parse(req.body);
    if (!ensureProgramModelAvailable(res)) return;
    const updated = await tenantScopedPrisma.program.update({
      where: { id },
      data: { name: body.name },
    });
    const ctx = getAuditContext(req);
    await AuditLogger.log(id, 'PROGRAM', 'PROGRAM.IDENTITY.UPDATED', ctx.actorId || 'system', ctx.actorType === 'USER' ? 'USER' : 'SYSTEM', {
      name: updated.name,
    });
    return res.json({ success: true, data: updated });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid program update' } });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    logger.error({ err }, 'Failed to update program identity');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to update program identity') } });
  }
});

// GET /api/programs/:id/rating-matrix — returns the published programme-model tables.
router.get('/:id/rating-matrix', async (req, res) => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id }, select: { id: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    const model = await tenantScopedPrisma.programRatingModel.findFirst({ where: { programId: id, status: 'PUBLISHED' }, orderBy: { version: 'desc' }, select: { id: true, version: true, tables: true } });
    if (!model) return res.status(422).json({ success: false, error: { code: 'PROGRAMME_RATING_MODEL_MISSING', message: 'No published rating model is configured for this programme.' } });
    return res.json({ success: true, data: model.tables, meta: { ratingModelId: model.id, version: model.version } });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid program id' } });
    }
    logger.error({ err: err }, 'Failed to load rating matrix:');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to load rating matrix') } });
  }
});

// GET /api/programs/:id/rating-model
// Returns latest PUBLISHED model if exists, else latest DRAFT, else 404.
router.get('/:id/definition/:binderProductAuthorityId', async (req, res) => {
  try {
    const { id: programId, binderProductAuthorityId } = ProgramDefinitionParamsSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    const definition = await resolveMappedProgramDefinition({ programId, binderProductAuthorityId });
    return res.json({ success: true, data: definition });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid request' } });
    }
    if (err instanceof ProgramDefinitionConfigurationError) {
      return res.status(422).json({ success: false, error: { code: err.code, message: err.message } });
    }
    logger.error({ err }, 'Failed to load programme definition');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to load programme definition') } });
  }
});

// GET /api/programs/:id/definitions
// Definition versions are immutable once published; the BO edits a DRAFT and
// explicitly maps that one reviewed version to the selected authorities.
router.get('/:id/definitions', async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    const definitions = await tenantScopedPrisma.programDefinitionVersion.findMany({
      where: { programId },
      orderBy: { version: 'desc' },
      include: { programRatingModel: { select: { id: true, version: true, status: true } } },
    });
    return res.json({ success: true, data: definitions });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid program id' } });
    logger.error({ err }, 'Failed to list programme definitions');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to list programme definitions') } });
  }
});

// The BO never carries product-specific authoring rules. It requests the
// product-owned descriptor through the programme's canonical product adapter.
router.get('/:id/definition-editor', async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({
      where: { id: programId },
      select: { id: true, productType: true },
    });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });

    const productType = String(program.productType || '').trim().toUpperCase();
    return res.json({ success: true, data: getProgrammeDefinitionEditorDescriptor(productType) });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid program id' } });
    if (err instanceof ProgrammeDefinitionEditorUnavailableError) {
      return res.status(422).json({ success: false, error: { code: err.code, message: err.message } });
    }
    logger.error({ err }, 'Failed to load programme definition editor descriptor');
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: errorMessage(err, 'Failed to load programme definition editor descriptor') } });
  }
});

// PUT /api/programs/:id/definitions/draft
// Creates or replaces the sole editable draft. Publication validation is also
// performed here so an invalid component cannot be saved as a plausible live
// setting and only fail during release.
router.put('/:id/definitions/draft', requirePermission('programs', 'edit'), programsAuditLog, async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    const body = ProgramDefinitionDraftBodySchema.parse(req.body);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true, productType: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    validateProgramDefinitionComponents({
      productType: String(program.productType || ''),
      pricingMode: body.pricingMode,
      components: {
        underwriting: body.underwriting as Prisma.JsonObject, coverage: body.coverage as Prisma.JsonObject,
        questionnaire: body.questionnaire as Prisma.JsonObject, workflow: body.workflow as Prisma.JsonObject,
        channels: body.channels as Prisma.JsonObject, documents: body.documents as Prisma.JsonObject,
      },
    });
    let ratingModelId: string | null = null;
    if (body.pricingMode === 'AUTOMATED') {
      if (!body.programRatingModelId) {
        return res.status(422).json({ success: false, error: { code: 'RATING_MODEL_REQUIRED', message: 'An automated programme definition requires a published rating model.' } });
      }
      const model = await tenantScopedPrisma.programRatingModel.findFirst({
        where: { id: body.programRatingModelId, programId, status: 'PUBLISHED' },
        select: { id: true, programId: true, version: true, stages: true, tables: true },
      });
      if (!model) return res.status(422).json({ success: false, error: { code: 'RATING_MODEL_NOT_PUBLISHED', message: 'The selected rating model is not published for this programme.' } });
      const mappedAuthority = await tenantScopedPrisma.binderProductAuthorityRatingModel.findFirst({
        where: { programRatingModelId: model.id },
        select: { binderProductAuthorityId: true },
      });
      if (!mappedAuthority) {
        return res.status(422).json({ success: false, error: { code: 'RATING_MODEL_NOT_MAPPED', message: 'Publish and map the rating model to an active binder product authority before selecting it for an automated programme definition.' } });
      }
      validateProgramRatingModel(String(program.productType || ''), {
        ...model,
        binderProductAuthorityId: mappedAuthority.binderProductAuthorityId,
      });
      ratingModelId = model.id;
    } else if (body.programRatingModelId) {
      return res.status(422).json({ success: false, error: { code: 'MANUAL_PROGRAMME_HAS_RATING_MODEL', message: 'A manually priced programme definition cannot select a rating model.' } });
    }
    const draft = await runTenantScopedTransaction(async (tx) => {
      const existing = await tx.programDefinitionVersion.findFirst({
        where: { programId, status: 'DRAFT' }, orderBy: { version: 'desc' }, select: { id: true },
      });
      const data = {
        pricingMode: body.pricingMode,
        programRatingModelId: ratingModelId,
        underwriting: toInputJson(body.underwriting),
        coverage: toInputJson(body.coverage),
        questionnaire: toInputJson(body.questionnaire),
        workflow: toInputJson(body.workflow),
        channels: toInputJson(body.channels),
        documents: toInputJson(body.documents),
        source: body.source,
        notes: body.notes,
      };
      if (existing) return tx.programDefinitionVersion.update({ where: { id: existing.id }, data });
      const latest = await tx.programDefinitionVersion.findFirst({ where: { programId }, orderBy: { version: 'desc' }, select: { version: true } });
      const createData: Prisma.ProgramDefinitionVersionUncheckedCreateInput = {
          operatingTenantId: getTenantConfig().id,
          programId,
          version: (latest?.version || 0) + 1,
          status: 'DRAFT',
          ...data,
        };
      return tx.programDefinitionVersion.create({ data: createData });
    });
    const ctx = getAuditContext(req);
    await AuditLogger.log(programId, 'PROGRAM', 'PROGRAM.DEFINITION.DRAFT_SAVED', ctx.actorId || 'system', ctx.actorType === 'USER' ? 'USER' : 'SYSTEM', {
      definitionId: draft.id, version: draft.version, pricingMode: draft.pricingMode,
    });
    return res.json({ success: true, data: draft });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid definition payload' } });
    logger.error({ err }, 'Failed to save programme definition draft');
    return res.status(422).json({ success: false, error: { code: 'PROGRAMME_DEFINITION_INVALID', message: errorMessage(err, 'Programme definition is invalid') } });
  }
});

// POST /api/programs/:id/definitions/:definitionId/publish
router.post('/:id/definitions/:definitionId/publish', requirePermission('programs', 'publish'), programsAuditLog, async (req, res) => {
  try {
    const { id: programId, definitionId } = ProgramDefinitionIdParamsSchema.parse(req.params);
    const body = PublishProgramDefinitionBodySchema.parse(req.body);
    if (!ensureProgramModelAvailable(res)) return;
    const published = await publishProgrammeDefinition({ programId, definitionId, ...body }, { tenantId: getTenantConfig().id, userId: req.user?.id ?? '', permissions: (req.resolvedPermissions ?? []).map((permission) => permission.key) });
    return res.json({ success: true, data: published });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.issues[0]?.message || 'Invalid publish request' } });
    logger.error({ err }, 'Failed to publish programme definition');
    return res.status(422).json({ success: false, error: { code: 'PROGRAMME_DEFINITION_INVALID', message: errorMessage(err, 'Programme definition is invalid') } });
  }
});

router.get('/:id/rating-model', async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true, productType: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    const published = await tenantScopedPrisma.programRatingModel.findFirst({
      where: { programId, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
    });
    if (published) return res.json({ success: true, data: published });

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
router.put('/:id/rating-model', requirePermission('programs', 'edit'), programsAuditLog, async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    const body = ProgramRatingModelBodySchema.parse(req.body) as ProgramRatingModelPayload;
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true, productType: true } });
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
// Publishes the latest DRAFT and maps it to explicitly selected active
// binder/product authorities. A published model may serve more than one
// authority, but no authority can silently inherit a program-level model.
router.post('/:id/rating-model/publish', requirePermission('programs', 'publish'), programsAuditLog, async (req, res) => {
  try {
    const { id: programId } = IdParamSchema.parse(req.params);
    const body = PublishProgramRatingModelBodySchema.parse(req.body);
    if (!ensureProgramModelAvailable(res)) return;
    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true, productType: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });
    const draft = await tenantScopedPrisma.programRatingModel.findFirst({
      where: { programId, status: 'DRAFT' },
      orderBy: { version: 'desc' },
    });
    if (!draft) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'No draft to publish' } });

    const authorities = await tenantScopedPrisma.binderProductAuthority.findMany({
      where: {
        id: { in: body.binderProductAuthorityIds },
        status: 'ACTIVE',
        productCode: String(program.productType || '').trim().toUpperCase(),
        binder: {
          status: 'ACTIVE',
          programLinks: { some: { programId, status: 'ACTIVE' } },
        },
      },
      select: { id: true },
    });
    if (authorities.length !== body.binderProductAuthorityIds.length) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'BINDER_PRODUCT_AUTHORITY_NOT_ELIGIBLE',
          message: 'Every selected authority must be active, match this product, and belong to an active binder link for this programme.',
        },
      });
    }
    try {
      for (const authority of authorities) {
        validateProgramRatingModel(String(program.productType || ''), {
          id: draft.id,
          programId: draft.programId,
          version: draft.version,
          binderProductAuthorityId: authority.id,
          stages: draft.stages,
          tables: draft.tables,
        });
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: { code: 'RATING_MODEL_INVALID', message: error instanceof Error ? error.message : 'Rating model validation failed.' },
      });
    }

    const published = await runTenantScopedTransaction(async (tx) => {
      const model = await tx.programRatingModel.update({
        where: { id: draft.id },
        data: { status: 'PUBLISHED' },
      });
      for (const authority of authorities) {
        await tx.binderProductAuthorityRatingModel.upsert({
          where: { binderProductAuthorityId: authority.id },
          update: { programRatingModelId: model.id },
          create: {
            binderProductAuthorityId: authority.id,
            programRatingModelId: model.id,
          },
        });
      }
      return model;
    });

    const ctx = getAuditContext(req);
    await AuditLogger.log(
      programId,
      'PROGRAM',
      'PROGRAM.RATING_MODEL.PUBLISHED',
      ctx.actorId || 'system',
      ctx.actorType === 'USER' ? 'USER' : 'SYSTEM',
      {
        ratingModelId: published.id,
        version: published.version,
        status: published.status,
        binderProductAuthorityIds: authorities.map((authority) => authority.id),
      }
    );
    return res.json({ success: true, data: published });
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

    const program = await tenantScopedPrisma.program.findUnique({ where: { id: programId }, select: { id: true, productType: true } });
    if (!program) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Program not found' } });

    const links = await runTenantScopedTransaction((tx) => tx.programBinderLink.findMany({
      where: { programId, program: { operatingTenantId: getTenantConfig().id }, binder: { operatingTenantId: getTenantConfig().id } },
      include: {
        binder: {
          include: {
            productAuthorities: {
              where: { productCode: String(program.productType || '').trim().toUpperCase() },
              select: { id: true, productCode: true, status: true, classOfBusiness: true, riskCode: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }));
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
router.post('/:id/binders', requirePermission('programs', 'edit'), programsAuditLog, async (req, res) => {
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

    const created = await runTenantScopedTransaction((tx) => tx.programBinderLink.create({
      data: {
        programId,
        binderId: String(binder.id),
        status: String(status || 'ACTIVE'),
        mapping: toInputJson(mapping ?? {}),
      },
    }));

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
router.delete('/:id/binders/:linkId', requirePermission('programs', 'edit'), programsAuditLog, async (req, res) => {
  try {
    const { id: programId, linkId } = LinkParamsSchema.parse(req.params);
    if (!ensureProgramModelAvailable(res)) return;

    const existing = await runTenantScopedTransaction((tx) => tx.programBinderLink.findFirst({ where: { id: linkId, programId, program: { operatingTenantId: getTenantConfig().id }, binder: { operatingTenantId: getTenantConfig().id } } }));
    if (!existing || existing.programId !== programId) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Link not found' } });
    }

    await runTenantScopedTransaction((tx) => tx.programBinderLink.delete({ where: { id: linkId, programId, program: { operatingTenantId: getTenantConfig().id }, binder: { operatingTenantId: getTenantConfig().id } } }));

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
