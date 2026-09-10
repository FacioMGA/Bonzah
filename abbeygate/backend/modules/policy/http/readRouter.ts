import type { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { ApiResponse } from '../../../platform/types/index.js';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { emailPolicyDocumentsUseCase } from '../app/read/emailPolicyDocumentsUseCase.js';
import { getPolicyFeedUseCase } from '../app/read/getPolicyFeedUseCase.js';
import { getIssueReadinessUseCase } from '../app/read/getIssueReadinessUseCase.js';
import { listPolicyDocumentsUseCase } from '../app/read/listPolicyDocumentsUseCase.js';
import { listPoliciesUseCase } from '../app/read/listPoliciesUseCase.js';
import { buildPolicyCountWhere, csvStringToArray, type PolicyDateBasis } from '../app/read/policyRepositoryCounts.js';
import { logger } from '../../../platform/utils/logger.js';
import {
  buildEmailPolicyDocumentsDeps,
  buildGetPolicyFeedDeps,
  buildGetIssueReadinessDeps,
  buildListPoliciesDeps,
  buildListPolicyDocumentsDeps,
} from './readRouter.adapters.js';
import {
  errorMessage,
  policyAuditLog,
  sendError,
  customerScopedListActor,
} from './readRouter.helpers.js';

const EmailDocumentsBodySchema = z.object({
  documentIds: z.array(z.string()).min(1),
});
type ErrorBody = ApiResponse<null>;

const boolFromUnknown = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return value;
}, z.boolean());

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DateInputSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    if (DATE_ONLY_REGEX.test(value)) return true;
    return !Number.isNaN(Date.parse(value));
  }, 'Invalid date format');

const PolicyCountsQuerySchema = z.object({
  start: DateInputSchema.optional(),
  end: DateInputSchema.optional(),
  dateBasis: z.enum(['createdAt', 'inceptionDate', 'issuedAt']).optional().default('inceptionDate'),
  programId: z.string().trim().optional(),
  binderId: z.string().trim().optional(),
  productType: z.string().trim().optional(),
  statusIn: z.string().trim().optional(),
  bdxOnly: boolFromUnknown.optional().default(false),
  includeHistoricalTerms: boolFromUnknown.optional().default(false),
});

const BdxMigrationStatusQuerySchema = z.object({
  runId: z.string().trim().optional(),
});

function parseDateInput(value: string | undefined, bound: 'start' | 'end'): Date | null {
  if (!value) return null;
  if (DATE_ONLY_REGEX.test(value)) {
    const [year, month, day] = value.split('-').map((part) => Number(part));
    const hour = bound === 'end' ? 23 : 0;
    const minute = bound === 'end' ? 59 : 0;
    const second = bound === 'end' ? 59 : 0;
    const ms = bound === 'end' ? 999 : 0;
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countToNumber(value: unknown): number {
  return Number(value || 0);
}

export function registerPolicyReadRoutes(router: Router) {
  function requestTenantOrUnauthorized(req: { tenantId?: string }, res: { status: (n: number) => { json: (b: unknown) => unknown } }): string | null {
    const tenantId = String(req.tenantId || '').trim();
    if (tenantId) return tenantId;
    res.status(401).json({
      success: false,
      error: { code: 'TENANT_REQUIRED', message: 'Authenticated tenant context is missing' },
    });
    return null;
  }

  router.get('/index-health', policyAuditLog, async (_req, res) => {
    try {
      const [indexedPolicies, totalPolicies, displayCompletePolicies] = await Promise.all([
        tenantScopedPrisma.policyListIndex.count(),
        tenantScopedPrisma.policy.count({ where: { productType: { not: null } } }),
        tenantScopedPrisma.policyListIndex.count({
          where: {
            AND: [
              { insuredDisplay: { not: null } },
              { vehicleDisplay: { not: null } },
              { policyholderDisplay: { not: null } },
              {
                OR: [
                  {
                    AND: [
                      { coverageStart: { not: null } },
                      { coverageEnd: { not: null } },
                    ],
                  },
                  { quoteExpiryDate: { not: null } },
                ],
              },
            ],
          },
        }),
      ]);
      const coveragePct = totalPolicies > 0 ? Number(((indexedPolicies / totalPolicies) * 100).toFixed(2)) : 100;
      const displayCompletenessPct =
        indexedPolicies > 0 ? Number(((displayCompletePolicies / indexedPolicies) * 100).toFixed(2)) : 100;
      const backfillRemainingCount = Math.max(indexedPolicies - displayCompletePolicies, 0);
      const partialResults = totalPolicies > 0 && indexedPolicies < totalPolicies;
      return res.json({
        success: true,
        data: {
          indexedPolicies,
          totalPolicies,
          coveragePct,
          displayCompletePolicies,
          displayCompletenessPct,
          backfillRemainingCount,
          partialResults,
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to compute policy index health') },
      });
    }
  });

  router.get('/counts', policyAuditLog, async (req, res) => {
    try {
      const query = PolicyCountsQuerySchema.parse(req.query);
      const start = parseDateInput(query.start, 'start');
      const end = parseDateInput(query.end, 'end');
      const statusIn = csvStringToArray(query.statusIn);
      const where = buildPolicyCountWhere({
        actor: customerScopedListActor(req.user, req.tenantId) || null,
        start,
        end,
        dateBasis: query.dateBasis as PolicyDateBasis,
        programId: query.programId || null,
        binderId: query.binderId || null,
        productType: query.productType || null,
        statusIn,
        bdxOnly: query.bdxOnly,
        includeHistoricalTerms: query.includeHistoricalTerms,
      });

      const [totalPolicies, byStatusRaw, byProgramRaw, byBinderRaw] = await Promise.all([
        tenantScopedPrisma.policy.count({ where }),
        tenantScopedPrisma.policy.groupBy({ by: ['status'], where, _count: { _all: true } }),
        tenantScopedPrisma.policy.groupBy({ by: ['programId'], where, _count: { _all: true } }),
        tenantScopedPrisma.policy.groupBy({ by: ['binderId'], where, _count: { _all: true } }),
      ]);

      const programIds = byProgramRaw.map((row) => String(row.programId || '')).filter(Boolean);
      const binderIds = byBinderRaw.map((row) => String(row.binderId || '')).filter(Boolean);
      const [programs, binders] = await Promise.all([
        programIds.length
          ? tenantScopedPrisma.program.findMany({ where: { id: { in: programIds } }, select: { id: true, name: true } })
          : Promise.resolve([]),
        binderIds.length
          ? tenantScopedPrisma.binder.findMany({ where: { id: { in: binderIds } }, select: { id: true, agreementNumber: true, umr: true } })
          : Promise.resolve([]),
      ]);
      const programNameById = new Map(programs.map((program) => [program.id, program.name]));
      const binderMetaById = new Map(binders.map((binder) => [binder.id, { agreementNumber: binder.agreementNumber, umr: binder.umr }]));

      return res.json({
        success: true,
        data: {
          filters: {
            start: start?.toISOString() || null,
            end: end?.toISOString() || null,
            dateBasis: query.dateBasis,
            programId: query.programId || null,
            binderId: query.binderId || null,
            productType: query.productType || null,
            statusIn,
            bdxOnly: query.bdxOnly,
            includeHistoricalTerms: query.includeHistoricalTerms,
          },
          totalPolicies,
          byStatus: byStatusRaw.map((row) => ({
            status: String(row.status || 'UNKNOWN'),
            count: countToNumber(row._count._all),
          })),
          byProgram: byProgramRaw.map((row) => ({
            programId: row.programId || null,
            programName: row.programId ? programNameById.get(String(row.programId)) || null : null,
            count: countToNumber(row._count._all),
          })),
          byBinder: byBinderRaw.map((row) => ({
            binderId: row.binderId || null,
            agreementNumber: row.binderId ? binderMetaById.get(String(row.binderId))?.agreementNumber || null : null,
            umr: row.binderId ? binderMetaById.get(String(row.binderId))?.umr || null : null,
            count: countToNumber(row._count._all),
          })),
        },
      });
    } catch (error) {
      logger.error({ err: error }, 'Policy counts error:');
      return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to compute policy counts'));
    }
  });

  router.get('/migration-status/bdx', policyAuditLog, async (req, res) => {
    try {
      const query = BdxMigrationStatusQuerySchema.parse(req.query);
      const runFilter = query.runId
        ? Prisma.sql`
          AND (
            psc.snapshot -> 'bdxImport' ->> 'runId' = ${query.runId}
            OR psc.snapshot -> 'endorsementMeta' -> 'bdxImport' ->> 'runId' = ${query.runId}
          )
        `
        : Prisma.empty;
      const endorsementRunFilter = query.runId
        ? Prisma.sql` AND COALESCE(rt."snapshotFinal", rt."snapshotDraft") -> 'endorsementMeta' -> 'bdxImport' ->> 'runId' = ${query.runId}`
        : Prisma.empty;

      const importedPolicies = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM "policy_state_current" psc
        JOIN "policies" p ON p.id = psc."policyId"
        WHERE (
          psc.snapshot -> 'bdxImport' ->> 'rowKey' IS NOT NULL
          OR psc.snapshot -> 'endorsementMeta' -> 'bdxImport' ->> 'rowKey' IS NOT NULL
        )
        ${runFilter}
      `;
      const importedByStatus = await prisma.$queryRaw<Array<{ status: string; count: number }>>`
        SELECT p.status AS status, COUNT(*)::int AS count
        FROM "policy_state_current" psc
        JOIN "policies" p ON p.id = psc."policyId"
        WHERE (
          psc.snapshot -> 'bdxImport' ->> 'rowKey' IS NOT NULL
          OR psc.snapshot -> 'endorsementMeta' -> 'bdxImport' ->> 'rowKey' IS NOT NULL
        )
        ${runFilter}
        GROUP BY p.status
        ORDER BY COUNT(*) DESC
      `;
      const latestImported = await prisma.$queryRaw<Array<{ policyId: string; policyNumber: string; sourcePolicyRef: string | null; sourceRowNumber: number | null }>>`
        SELECT
          p.id AS "policyId",
          p."policyNumber" AS "policyNumber",
          COALESCE(
            psc.snapshot -> 'bdxImport' ->> 'sourcePolicyRef',
            psc.snapshot -> 'endorsementMeta' -> 'bdxImport' ->> 'sourcePolicyRef'
          ) AS "sourcePolicyRef",
          NULLIF(
            COALESCE(
              psc.snapshot -> 'bdxImport' ->> 'sourceRowNumber',
              psc.snapshot -> 'endorsementMeta' -> 'bdxImport' ->> 'sourceRowNumber'
            ),
            ''
          )::int AS "sourceRowNumber"
        FROM "policy_state_current" psc
        JOIN "policies" p ON p.id = psc."policyId"
        WHERE (
          psc.snapshot -> 'bdxImport' ->> 'rowKey' IS NOT NULL
          OR psc.snapshot -> 'endorsementMeta' -> 'bdxImport' ->> 'rowKey' IS NOT NULL
        )
        ${runFilter}
        ORDER BY NULLIF(
          COALESCE(
            psc.snapshot -> 'bdxImport' ->> 'sourceRowNumber',
            psc.snapshot -> 'endorsementMeta' -> 'bdxImport' ->> 'sourceRowNumber'
          ),
          ''
        )::int DESC NULLS LAST
        LIMIT 1
      `;
      const replayRows = await prisma.$queryRaw<Array<{ replayRows: number; replayPolicies: number }>>`
        SELECT
          COUNT(*)::int AS "replayRows",
          COUNT(DISTINCT rt."policyId")::int AS "replayPolicies"
        FROM "risk_transactions" rt
        WHERE rt."transactionType" IN ('ENDORSEMENT', 'RENEWAL')
          AND COALESCE(rt."snapshotFinal", rt."snapshotDraft") -> 'endorsementMeta' -> 'bdxImport' ->> 'rowKey' IS NOT NULL
          ${endorsementRunFilter}
      `;
      const latestReplay = await prisma.$queryRaw<Array<{ policyId: string; sourcePolicyRef: string | null; sourceRowNumber: number | null }>>`
        SELECT
          rt."policyId" AS "policyId",
          COALESCE(rt."snapshotFinal", rt."snapshotDraft") -> 'endorsementMeta' -> 'bdxImport' ->> 'sourcePolicyRef' AS "sourcePolicyRef",
          NULLIF(COALESCE(rt."snapshotFinal", rt."snapshotDraft") -> 'endorsementMeta' -> 'bdxImport' ->> 'sourceRowNumber', '')::int AS "sourceRowNumber"
        FROM "risk_transactions" rt
        WHERE rt."transactionType" IN ('ENDORSEMENT', 'RENEWAL')
          AND COALESCE(rt."snapshotFinal", rt."snapshotDraft") -> 'endorsementMeta' -> 'bdxImport' ->> 'rowKey' IS NOT NULL
          ${endorsementRunFilter}
        ORDER BY NULLIF(COALESCE(rt."snapshotFinal", rt."snapshotDraft") -> 'endorsementMeta' -> 'bdxImport' ->> 'sourceRowNumber', '')::int DESC NULLS LAST
        LIMIT 1
      `;

      return res.json({
        success: true,
        data: {
          runId: query.runId || null,
          importedPolicies: {
            total: importedPolicies[0]?.count || 0,
            byStatus: importedByStatus,
            latest: latestImported[0] || null,
          },
          replayedEndorsements: {
            totalRows: replayRows[0]?.replayRows || 0,
            distinctPolicies: replayRows[0]?.replayPolicies || 0,
            latest: latestReplay[0] || null,
          },
        },
      });
    } catch (error) {
      logger.error({ err: error }, 'BDX migration status error:');
      return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to compute BDX migration status'));
    }
  });

  /**
   * GET /api/policies/:id/feed
   * Get audit feed for a policy
   */
  router.get('/:id/feed', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const tenantId = requestTenantOrUnauthorized(req, res);
      if (!tenantId) return;
      const result = await getPolicyFeedUseCase(
        { policyId: id, tenantId },
        buildGetPolicyFeedDeps()
      );
      return res.status(result.status).json(result.body);
    } catch (error) {
      logger.error({ err: error }, 'Audit feed error:');
      return res.status(500).json({ success: false, error: (error as Error).message });
    }
  });

  /**
   * GET /api/policies
   * List policies (Read from Projection)
   */
  router.get('/', policyAuditLog, async (req, res) => {
    const startedAtMs = Date.now();
    try {
      const result = await listPoliciesUseCase(
        {
          query: req.query as Record<string, unknown>,
          actor: customerScopedListActor(req.user, req.tenantId) || null,
          startedAtMs,
          tenantId: typeof req.tenantId === 'string' ? req.tenantId : undefined,
        },
        buildListPoliciesDeps()
      );
      return res.status(result.status).json(result.body);
    } catch (error) {
      logger.error({ err: error }, 'List policies error:');
      return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to list policies'));
    }
  });

  /**
   * GET /api/policies/:id/documents
   * Fetch documents for a specific policy
   */
  router.get('/:id/documents', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const tenantId = requestTenantOrUnauthorized(req, res);
      if (!tenantId) return;
      const result = await listPolicyDocumentsUseCase(
        { policyId: id, tenantId },
        buildListPolicyDocumentsDeps()
      );
      return res.status(result.status).json(result.body);
    } catch (error) {
      logger.error({ err: error }, 'Fetch documents error:');
      return res.status(500).json({ success: false, error: errorMessage(error, 'Failed to fetch documents') });
    }
  });

  /**
   * POST /api/policies/:id/documents/email
   * Emails selected documents to the policyholder.
   */
  router.post('/:id/documents/email', policyAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const tenantId = requestTenantOrUnauthorized(req, res);
      if (!tenantId) return;
      const parsedBody = EmailDocumentsBodySchema.safeParse(req.body || {});
      if (!parsedBody.success) {
        const payload: ErrorBody & { details: ReturnType<typeof parsedBody.error.flatten> } = {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'documentIds is required' },
          details: parsedBody.error.flatten(),
        };
        return res.status(400).json(payload);
      }
      const result = await emailPolicyDocumentsUseCase(
        {
          policyId,
          tenantId,
          documentIds: parsedBody.data.documentIds.map((x) => String(x)),
        },
        buildEmailPolicyDocumentsDeps()
      );
      return res.status(result.status).json(result.body);
    } catch (error) {
      logger.error({ err: error }, 'Email documents error:');
      return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to email documents'));
    }
  });

  /**
   * GET /api/policies/:id/issue-readiness?channel=bo|customer
   * Computes canIssue + blockers for UI guardrails.
   */
  router.get('/:id/issue-readiness', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const channel = String(req.query.channel || 'bo') === 'customer' ? 'customer' : 'bo';
      const riskTransactionId = req.query.riskTransactionId ? String(req.query.riskTransactionId) : null;
      const result = await getIssueReadinessUseCase(
        {
          policyId: id,
          channel,
          riskTransactionId,
        },
        buildGetIssueReadinessDeps()
      );
      return res.status(result.status).json(result.body);
    } catch (error) {
      logger.error({ err: error }, 'Issue readiness error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to compute issue readiness') } });
    }
  });

  /**
   * GET /api/policies/:id/calculation-audit?limit=20
   * Returns the latest immutable price calculation audit rows for a policy.
   * Powers the BO "Calculation history" modal and BDX reconciliation tooling.
   */
  router.get('/:id/calculation-audit', policyAuditLog, async (req, res) => {
    try {
      const { id } = req.params;
      const limitRaw = Number(req.query.limit ?? 20);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), 100) : 20;
      const { listPriceAudit } = await import('../app/pricing/priceAuditRecorder.js');
      const rows = await listPriceAudit(id, limit);
      return res.json({ success: true, data: rows });
    } catch (error) {
      logger.error({ err: error }, 'calculation_audit.read.error');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to load calculation audit') } });
    }
  });
}
