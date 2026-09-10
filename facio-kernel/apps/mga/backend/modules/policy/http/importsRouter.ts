import type { NextFunction, Request, Response, Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import multer from 'multer';
import { promises as fs } from 'node:fs';
import { evaluateBdxMigrationImportRequest } from '../../reporting/app/bdxImport/service.js';
import type { BdxImportRequest } from '../../reporting/app/bdxImport/types.js';
import { executeBdxImportLiveRun } from '../app/bdxImport/bdxImportOrchestrator.js';
import { wipeBdxImportedPoliciesForTenant } from '../app/bdxImport/bdxImportWipe.js';
import { runTestDataReset } from '../app/bdxImport/testDataReset.js';
import { routeEventToQueue } from '../../../platform/events/queue.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { runWithOperatingTenant } from '../../../platform/tenant/tenantAls.js';
import { loadTenantBySlug } from '../../../platform/tenant/tenantJobContext.js';
import type { BdxImportActor, BdxImportRequestUrlContext } from '../app/bdxImport/bdxImportTypes.js';
import {
  resolveBdxBinderProductAuthorityId,
  resolveProgramBinder,
  sourceHashFromPath,
  uploadToTempBdx,
} from '../app/bdxImport/bdxImportContext.js';
import {
  createBdxImportJob,
  getBdxImportJob,
  getBdxImportJobResult,
  listBdxImportJobLogs,
} from '../app/bdxImport/bdxImportJobRepository.js';
import { logger } from '../../../platform/utils/logger.js';
import { errorMessage } from '../../../platform/http/httpErrors.js';
import { getClientIpForRateLimit, readRateLimitInt } from '../../../platform/http/middleware/rateLimit.js';

// The legacy dry-run import route still needs filesystem access when supplied
// a server-side source path. Keep that exceptional migration lane tightly
// rate-limited as well as DevOps-only; BDX work is otherwise performed by the
// queued /dry-run and /commit routes below.
const legacyBdxImportLimiter = rateLimit({
  windowMs: readRateLimitInt('RATE_LIMIT_LEGACY_BDX_IMPORT_WINDOW_MS', 15 * 60 * 1000),
  max: readRateLimitInt('RATE_LIMIT_LEGACY_BDX_IMPORT_MAX', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const tenantId = String(req.headers['x-tenant-id'] || '').trim() || 'no-tenant';
    const actorId = String(req.user?.id || '').trim() || 'no-user';
    return `legacy-bdx-import:${tenantId}:${actorId}:${getClientIpForRateLimit(req)}`;
  },
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
  },
});

const boolFromUnknown = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return value;
}, z.boolean());

const ImportBodySchema = z.object({
  sourceFilePath: z.string().trim().min(1).optional(),
  dryRun: boolFromUnknown.optional().default(true),
  startRow: z.coerce.number().int().positive().optional(),
  endRow: z.coerce.number().int().positive().optional(),
  maxImports: z.coerce.number().int().positive().max(1000).optional().default(250),
  tolerances: z.object({
    gross: z.coerce.number().nonnegative().optional(),
    commission: z.coerce.number().nonnegative().optional(),
    tax: z.coerce.number().nonnegative().optional(),
    fees: z.coerce.number().nonnegative().optional(),
    net: z.coerce.number().nonnegative().optional(),
    total: z.coerce.number().nonnegative().optional(),
  }).optional(),
  programId: z.string().uuid().optional(),
  binderId: z.string().optional(),
  accountId: z.string().optional(),
});

const BdxProductLineSchema = z.enum(['motor', 'travel', 'home']);
const BdxFileTypeSchema = z.enum(['xlsx', 'csv']);

// Real tenant slugs (matches prisma/seed.ts). Kept in one place so the import,
// wipe and reset routes stay in lockstep with the provisioned tenant set.
const TenantSlugSchema = z.enum(['abbeygate-cy', 'abbeygate-pt', 'abbeygate-gr', 'abbeygate-es']);

const BdxDryRunJobBodySchema = z.object({
  sourceFilePath: z.string().trim().min(1).optional(),
  productLine: BdxProductLineSchema.default('motor'),
  fileType: BdxFileTypeSchema.optional(),
  tenantSlug: TenantSlugSchema.optional(),
});

const BdxCommitJobBodySchema = z.object({
  dryRunJobId: z.string().uuid(),
  approved: boolFromUnknown,
});

const BdxWipeBodySchema = z.object({
  tenantSlug: TenantSlugSchema,
  product: z.enum(['MOTOR', 'TRAVEL', 'HOME']).optional(),
  commit: boolFromUnknown.optional().default(false),
});

// Pre-go-live test-data reset (ADR-0051) — restricted to the go-live tenants.
// Selection is by the test-email predicate (see testDataReset.ts), not product.
const TestDataResetBodySchema = z.object({
  tenantSlug: z.enum(['abbeygate-cy', 'abbeygate-pt', 'abbeygate-gr']),
  commit: boolFromUnknown.optional().default(false),
});

function actorFromRequest(req: Request): BdxImportActor {
  const user = req.user;
  return {
    id: user && typeof user.id === 'string' ? user.id : null,
    name: user && typeof user.name === 'string' ? user.name : null,
    email: user && typeof user.email === 'string' ? user.email : null,
    role: user && typeof user.role === 'string' ? user.role : null,
  };
}

function requestUrlContextFromRequest(req: Request): BdxImportRequestUrlContext {
  return {
    protocol: req.protocol,
    host: req.get('host') || '',
    origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
  };
}

function policyAuditLog(req: Request, _res: Response, next: NextFunction): void {
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

function requireFacioDevOps(req: Request, res: Response, next: NextFunction): void {
  const role = String(req.user?.role || '').toUpperCase();
  if (role !== 'ADMIN') {
    res.status(403).json({
      success: false,
      error: {
        code: 'BDX_IMPORT_DEVOPS_ONLY',
        message: 'BDX import jobs are restricted to Facio DevOps.',
      },
    });
    return;
  }
  next();
}

function inferFileType(args: { uploadFileName?: string; sourceFilePath?: string; explicit?: 'xlsx' | 'csv' }): 'xlsx' | 'csv' {
  const { uploadFileName, sourceFilePath, explicit } = args;
  if (explicit) return explicit;
  const name = String(uploadFileName || sourceFilePath || '').toLowerCase();
  return name.endsWith('.csv') ? 'csv' : 'xlsx';
}

function assertSupportedUpload(req: Request, fileType: 'xlsx' | 'csv'): void {
  if (!req.file) return;
  const fileName = String(req.file.originalname || '').toLowerCase();
  const mime = String(req.file.mimetype || '').toLowerCase();
  const looksCsv = fileName.endsWith('.csv') || mime.includes('csv') || mime.includes('text/plain');
  const looksExcel = fileName.endsWith('.xlsx') || mime.includes('spreadsheetml') || mime.includes('excel');
  if (fileType === 'csv' && looksCsv) return;
  if (fileType === 'xlsx' && looksExcel) return;
  throw new Error(`BDX import ${fileType} upload does not match the provided file.`);
}

async function enqueueBdxImportJob(jobId: string): Promise<void> {
  await routeEventToQueue('BDX.IMPORT_JOB', {
    eventId: `bdx-import-job-${jobId}`,
    jobId,
  });
}

async function resolveRequestedTenant(tenantSlug?: string) {
  if (!tenantSlug) return getTenantConfig();
  const tenant = await loadTenantBySlug(tenantSlug);
  if (!tenant) throw new Error(`Unknown BDX import tenant slug: ${tenantSlug}`);
  return tenant;
}

export function registerPolicyImportRoutes(router: Router) {
  router.post('/imports/bdx/dry-run', policyAuditLog, requireFacioDevOps, upload.single('file'), async (req: Request, res: Response) => {
    try {
      const parsed = BdxDryRunJobBodySchema.parse(req.body || {});
      if (!req.file && !parsed.sourceFilePath) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'BDX_SOURCE_REQUIRED',
            message: 'Provide either multipart file upload (file) or sourceFilePath.',
          },
        });
      }
      const fileType = inferFileType({
        uploadFileName: req.file?.originalname,
        sourceFilePath: parsed.sourceFilePath,
        explicit: parsed.fileType,
      });
      assertSupportedUpload(req, fileType);
      const sourceResolved = req.file
        ? await uploadToTempBdx(req.file)
        : {
            sourceFilePath: parsed.sourceFilePath!,
            sourceHash: await sourceHashFromPath(parsed.sourceFilePath!),
          };
      const tenant = await resolveRequestedTenant(parsed.tenantSlug);
      const job = await runWithOperatingTenant(tenant, () => createBdxImportJob({
          operatingTenantId: tenant.id,
          tenantHost: new URL(tenant.publicBaseUrl).host,
          productLine: parsed.productLine,
          fileType,
          mode: 'dryRun',
          sourceFileHash: sourceResolved.sourceHash,
          sourceFilePath: sourceResolved.sourceFilePath,
          sourceFileBytes: req.file?.buffer || null,
          createdBy: actorFromRequest(req).id,
        }));
      await enqueueBdxImportJob(job.id);
      return res.json({ success: true, data: { jobId: job.id, status: job.status } });
    } catch (error) {
      logger.error({ err: error }, 'BDX dry-run job endpoint failed');
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: error.issues[0]?.message || 'Invalid request payload' } });
      }
      return res.status(500).json({ success: false, error: { code: 'BDX_DRY_RUN_JOB_FAILED', message: errorMessage(error, 'BDX dry-run job failed') } });
    }
  });

  router.post('/imports/bdx/commit', policyAuditLog, requireFacioDevOps, async (req: Request, res: Response) => {
    try {
      const parsed = BdxCommitJobBodySchema.parse(req.body || {});
      if (!parsed.approved) {
        return res.status(400).json({ success: false, error: { code: 'BDX_COMMIT_APPROVAL_REQUIRED', message: 'Commit requires approved: true.' } });
      }
      const dryRunJob = await getBdxImportJob(parsed.dryRunJobId);
      if (!dryRunJob || dryRunJob.mode !== 'dryRun') {
        return res.status(404).json({ success: false, error: { code: 'BDX_DRY_RUN_JOB_NOT_FOUND', message: 'Dry-run job not found.' } });
      }
      if (dryRunJob.status !== 'ready_for_commit') {
        return res.status(409).json({ success: false, error: { code: 'BDX_DRY_RUN_NOT_READY', message: 'Dry-run job must complete successfully before commit.' } });
      }
      const tenant = getTenantConfig();
      const job = await createBdxImportJob({
        operatingTenantId: tenant.id,
        tenantHost: dryRunJob.tenantHost,
        productLine: dryRunJob.productLine,
        fileType: dryRunJob.fileType,
        mode: 'commit',
        dryRunJobId: dryRunJob.id,
        sourceFileHash: dryRunJob.sourceFileHash,
        sourceFilePath: dryRunJob.sourceFilePath,
        sourceFileBytes: dryRunJob.sourceFileBytes,
        createdBy: actorFromRequest(req).id,
      });
      await enqueueBdxImportJob(job.id);
      return res.json({ success: true, data: { jobId: job.id, status: job.status } });
    } catch (error) {
      logger.error({ err: error }, 'BDX commit job endpoint failed');
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: error.issues[0]?.message || 'Invalid request payload' } });
      }
      return res.status(500).json({ success: false, error: { code: 'BDX_COMMIT_JOB_FAILED', message: errorMessage(error, 'BDX commit job failed') } });
    }
  });

  router.get('/imports/bdx/jobs/:jobId/status', policyAuditLog, requireFacioDevOps, async (req: Request, res: Response) => {
    const job = await getBdxImportJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: { code: 'BDX_JOB_NOT_FOUND', message: 'BDX import job not found.' } });
    return res.json({
      success: true,
      data: {
        jobId: job.id,
        tenantHost: job.tenantHost,
        operatingTenantId: job.operatingTenantId,
        productLine: job.productLine,
        mode: job.mode,
        status: job.status,
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        successRows: job.successRows,
        failedRows: job.failedRows,
        currentStep: job.currentStep,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      },
    });
  });

  router.get('/imports/bdx/jobs/:jobId/logs', policyAuditLog, requireFacioDevOps, async (req: Request, res: Response) => {
    const job = await getBdxImportJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: { code: 'BDX_JOB_NOT_FOUND', message: 'BDX import job not found.' } });
    const logs = await listBdxImportJobLogs(job.id);
    return res.json({ success: true, data: logs });
  });

  // Staging-only granular wipe of BDX-imported policies.
  // See docs/operate/bdx-recovery-rules.md — production correction must
  // use the endorsement chain, never this route.
  //
  // Gate: `ALLOW_DESTRUCTIVE_BDX_WIPE=1` must be set on the API process for
  // `commit:true` to proceed. Dry-run (commit=false) is always allowed for
  // ADMINs because it is read-only. We do NOT gate on NODE_ENV because the
  // staging cluster (cy4) deliberately runs with NODE_ENV=production for
  // startup-validation parity (helm runtime-configmap), so the explicit
  // opt-in env var is the only honest signal.
  router.post('/imports/bdx/wipe', policyAuditLog, requireFacioDevOps, async (req: Request, res: Response) => {
    try {
      const parsed = BdxWipeBodySchema.parse(req.body || {});
      if (parsed.commit && process.env.ALLOW_DESTRUCTIVE_BDX_WIPE !== '1') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'BDX_WIPE_NOT_AUTHORIZED',
            message: 'commit:true requires ALLOW_DESTRUCTIVE_BDX_WIPE=1 on the API process. This opt-in MUST NOT be set on production deployments (see docs/operate/bdx-recovery-rules.md).',
          },
        });
      }
      const tenant = await loadTenantBySlug(parsed.tenantSlug);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: { code: 'TENANT_NOT_FOUND', message: `Unknown tenant slug: ${parsed.tenantSlug}` },
        });
      }
      const result = await runWithOperatingTenant(tenant, () =>
        wipeBdxImportedPoliciesForTenant({
          tenantSlug: tenant.tenantSlug,
          operatingTenantId: tenant.id,
          product: parsed.product || null,
          commit: parsed.commit,
        }),
      );
      return res.json({ success: true, data: result });
    } catch (error) {
      logger.error({ err: error }, 'BDX wipe endpoint failed');
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: error.issues[0]?.message || 'Invalid request payload' } });
      }
      return res.status(500).json({ success: false, error: { code: 'BDX_WIPE_FAILED', message: errorMessage(error, 'BDX wipe failed') } });
    }
  });

  // Pre-go-live test-data reset (ADR-0051): delete the NON-BDX (untagged) test
  // policies/quotes on a go-live tenant, keeping the imported book. Inverse of
  // /imports/bdx/wipe. Dry-run (commit=false) is read-only and always allowed
  // for ADMINs; commit=true requires ALLOW_DESTRUCTIVE_TESTDATA_RESET=1 on the
  // API process (set only for the one-time reset, then removed). The app layer
  // enforces the tenant allowlist + the import-first invariant.
  router.post('/imports/bdx/test-data-reset', policyAuditLog, requireFacioDevOps, async (req, res) => {
    try {
      const parsed = TestDataResetBodySchema.parse(req.body || {});
      if (parsed.commit && process.env.ALLOW_DESTRUCTIVE_TESTDATA_RESET !== '1') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'TESTDATA_RESET_NOT_AUTHORIZED',
            message: 'commit:true requires ALLOW_DESTRUCTIVE_TESTDATA_RESET=1 on the API process (ADR-0051). Set it only for the one-time go-live reset, then remove it.',
          },
        });
      }
      const tenant = await loadTenantBySlug(parsed.tenantSlug);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: { code: 'TENANT_NOT_FOUND', message: `Unknown tenant slug: ${parsed.tenantSlug}` },
        });
      }
      const result = await runWithOperatingTenant(tenant, () =>
        runTestDataReset({
          tenantSlug: tenant.tenantSlug,
          operatingTenantId: tenant.id,
          commit: parsed.commit,
        }),
      );
      return res.json({ success: true, data: result });
    } catch (error) {
      logger.error({ err: error }, 'BDX test-data reset endpoint failed');
      if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: error.issues[0]?.message || 'Invalid request payload' } });
      }
      return res.status(500).json({ success: false, error: { code: 'TESTDATA_RESET_FAILED', message: errorMessage(error, 'BDX test-data reset failed') } });
    }
  });

  router.get('/imports/bdx/jobs/:jobId/result', policyAuditLog, requireFacioDevOps, async (req: Request, res: Response) => {
    const job = await getBdxImportJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: { code: 'BDX_JOB_NOT_FOUND', message: 'BDX import job not found.' } });
    const result = await getBdxImportJobResult(job.id);
    if (!result) return res.status(404).json({ success: false, error: { code: 'BDX_JOB_RESULT_NOT_READY', message: 'BDX import job result is not ready.' } });
    return res.json({ success: true, data: result });
  });

  // Legacy migration lane (dev/pipeline-operated): customer data migration import.
  router.post('/imports/bdx', policyAuditLog, requireFacioDevOps, legacyBdxImportLimiter, upload.single('file'), async (req, res) => {
    let tmpUploadedPath: string | null = null;
    try {
      const parsed = ImportBodySchema.parse(req.body || {});
      if (!parsed.dryRun) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'BDX_DIRECT_COMMIT_DISABLED',
            message: 'Live BDX import must use /imports/bdx/dry-run followed by /imports/bdx/commit.',
          },
        });
      }
      if (!req.file && !parsed.sourceFilePath) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'BDX_SOURCE_REQUIRED',
            message: 'Provide either multipart file upload (file) or sourceFilePath.',
          },
        });
      }
      if (req.file) {
        const fileName = String(req.file.originalname || '').toLowerCase();
        const mime = String(req.file.mimetype || '').toLowerCase();
        const looksExcel = fileName.endsWith('.xlsx') || mime.includes('spreadsheetml') || mime.includes('excel');
        if (!looksExcel) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'UNSUPPORTED_FILE_TYPE',
              message: 'BDX import only accepts .xlsx files.',
            },
          });
        }
      }

      const sourceResolved = req.file
        ? await uploadToTempBdx(req.file)
        : {
            sourceFilePath: parsed.sourceFilePath!,
            sourceHash: await sourceHashFromPath(parsed.sourceFilePath!),
          };
      if (req.file) tmpUploadedPath = sourceResolved.sourceFilePath;

      const runId = `bdx-${Date.now()}-${Buffer.from(crypto.randomBytes(4)).toString('hex')}`;
      const resolved = await resolveProgramBinder({
        programId: parsed.programId,
        binderId: parsed.binderId,
      });
      if (!resolved.program || resolved.binders.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'PROGRAM_BINDER_REQUIRED',
            message: 'An active Program and Binder are required for import.',
          },
        });
      }
      if (!resolved.linkOk) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'PROGRAM_BINDER_LINK_MISSING',
            message: 'Program and Binder are not actively linked.',
          },
        });
      }
      const binderProductAuthorityId = await resolveBdxBinderProductAuthorityId({
        binderId: parsed.binderId || resolved.binders[0]?.id,
        productType: resolved.program.productType,
      });
      if (!binderProductAuthorityId) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'BINDER_PRODUCT_AUTHORITY_REQUIRED',
            message: 'The selected Program and Binder need a product authority before BDX rating can run.',
          },
        });
      }

      const request: BdxImportRequest = {
        sourceFilePath: sourceResolved.sourceFilePath,
        sourceHash: sourceResolved.sourceHash,
        dryRun: parsed.dryRun,
        startRow: parsed.startRow,
        endRow: parsed.endRow,
        tolerances: parsed.tolerances,
        importRunId: runId,
        accountId: parsed.accountId || null,
        programId: resolved.program.id,
        binderId: parsed.binderId || resolved.binders[0]?.id || null,
        binderProductAuthorityId,
      };
      const result = await evaluateBdxMigrationImportRequest({
        request,
        runId,
        program: { id: resolved.program.id },
      });

      if (!parsed.dryRun) {
        await executeBdxImportLiveRun({
          result,
          request,
          runId,
          maxImports: parsed.maxImports,
          accountId: parsed.accountId || null,
          program: { id: resolved.program.id },
          binders: resolved.binders,
          context: {
            actor: actorFromRequest(req),
            correlationId: req.correlationId || '',
            reqUrlContext: requestUrlContextFromRequest(req),
          },
        });
      }

      result.summary.rejectedRows = result.evaluations.filter((x) => x.result === 'FAIL').length;
      result.outputs.policyCreationSummary.importedPolicyIds = [...result.summary.generatedPolicyIds];
      result.outputs.policyCreationSummary.importedCount = result.summary.importedRows;
      result.outputs.policyCreationSummary.rejectedCount = result.summary.rejectedRows;
      return res.json({ success: true, data: result });
    } catch (error) {
      logger.error({ err: error }, 'BDX import endpoint failed:');
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'BAD_REQUEST',
            message: error.issues[0]?.message || 'Invalid request payload',
          },
        });
      }
      return res.status(500).json({
        success: false,
        error: {
          code: 'BDX_IMPORT_FAILED',
          message: errorMessage(error, 'BDX import failed'),
        },
      });
    } finally {
      if (tmpUploadedPath) {
        await fs.unlink(tmpUploadedPath).catch(() => undefined);
      }
    }
  });
}
