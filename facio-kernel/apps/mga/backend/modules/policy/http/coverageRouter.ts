import type { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response, Router } from 'express';
import { tenantScopedPrisma, runTenantScopedTransaction } from '../../../platform/db/connection.js';
import { AuditLogger } from '../../../platform/audit/logger.js';
import { resolveProgrammeCoverageConfiguration } from '../app/resolveProgrammeCoverageConfiguration.js';
import { assertEndorsementDraftRiskTransaction, isIssuedLifecycleStatus, jsonParse, persistWorkspaceSnapshot } from '../app/shared.js';
import { resolveEffectiveQuoteData } from '../app/effectiveQuoteData.js';
import { z } from 'zod';
import {
  normalizeCoverageSelectionForHttp,
  parseCoverageSelectionForHttp,
  resolveCoverageContractForHttp,
} from '../app/coverageSelectionHttpProjection.js';
import { buildCoverageOptionsViewForProduct, productAdapterExists } from '../app/productRegistryService.js';

import { logger } from '../../../platform/utils/logger.js';
import { parseRecord } from '../../../platform/json/parseRecord.js';
function policyCoverageAuditLog(req: Request, _res: Response, next: NextFunction): void {
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
const CoverageSelectionBodySchema = z.object({
  riskTransactionId: z.union([z.string(), z.number()]).optional(),
  selected: z.record(z.string(), z.unknown()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
const CoverageSelectionResponseSchema = z.object({
  schemaVersion: z.literal(1),
  programId: z.string().nullable(),
  programCode: z.string().nullable(),
  selected: z.record(z.string(), z.boolean()),
  params: z.record(z.string(), z.unknown()),
  source: z.string().optional(),
  updatedAt: z.string().optional(),
  bo_initialized: z.boolean().optional(),
  defaults: z.object({
    selected: z.record(z.string(), z.boolean()),
    params: z.record(z.string(), z.unknown()),
  }).optional(),
  resolvedCoverageSet: z.object({
    productType: z.string(),
    programCode: z.string(),
    selectedCodes: z.array(z.string()),
    items: z.array(z.object({
      code: z.string(),
      title: z.string(),
      summary: z.string().optional(),
      type: z.string(),
      scope: z.string(),
      group: z.string().optional(),
      enabled: z.boolean(),
      selected: z.boolean(),
      source: z.enum(['base', 'option']),
      params: z.record(z.string(), z.unknown()),
      targetId: z.string().optional(),
    })),
    applied: z.array(z.object({
      code: z.string(),
      params: z.record(z.string(), z.unknown()).optional(),
      targetId: z.string().optional(),
    })),
  }),
  requiresProgram: z.boolean().optional(),
});

const CoverageOptionsViewResponseSchema = z.object({
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    items: z.array(z.object({
      code: z.string(),
      label: z.string(),
      summary: z.string().optional(),
      selected: z.boolean(),
      params: z.record(z.string(), z.unknown()),
      premiumImpact: z.number().nullable(),
      status: z.enum(['active', 'pending', 'included', 'available']),
      configurable: z.boolean(),
      scope: z.string(),
      targetOptions: z.array(z.object({
        id: z.string(),
        label: z.string(),
      })),
      helpText: z.string().optional(),
      legalText: z.string().optional(),
      formFields: z.array(z.object({
        name: z.string(),
        label: z.string(),
        type: z.string(),
        required: z.boolean(),
        options: z.array(z.string()).optional(),
      })).optional(),
      defaultParams: z.record(z.string(), z.unknown()).optional(),
      disallowedWith: z.array(z.string()).optional(),
    })),
  })),
  savedSelection: z.object({
    schemaVersion: z.literal(1),
    programId: z.string().nullable(),
    programCode: z.string().nullable(),
    selected: z.record(z.string(), z.boolean()),
    params: z.record(z.string(), z.unknown()),
    source: z.string().optional(),
    updatedAt: z.string().optional(),
    requiresProgram: z.boolean().optional(),
    bo_initialized: z.boolean().optional(),
    defaults: z.object({
      selected: z.record(z.string(), z.boolean()),
      params: z.record(z.string(), z.unknown()),
    }).optional(),
    resolvedCoverageSet: z.object({
      productType: z.string(),
      programCode: z.string(),
      selectedCodes: z.array(z.string()),
      items: z.array(z.object({
        code: z.string(),
        title: z.string(),
        summary: z.string().optional(),
        type: z.string(),
        scope: z.string(),
        group: z.string().optional(),
        enabled: z.boolean(),
        selected: z.boolean(),
        source: z.enum(['base', 'option']),
        params: z.record(z.string(), z.unknown()),
        targetId: z.string().optional(),
      })),
      applied: z.array(z.object({
        code: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
        targetId: z.string().optional(),
      })),
    }),
  }),
  resolvedCoverageSet: z.object({
    productType: z.string(),
    programCode: z.string(),
    selectedCodes: z.array(z.string()),
    items: z.array(z.object({
      code: z.string(),
      title: z.string(),
      summary: z.string().optional(),
      type: z.string(),
      scope: z.string(),
      group: z.string().optional(),
      enabled: z.boolean(),
      selected: z.boolean(),
      source: z.enum(['base', 'option']),
      params: z.record(z.string(), z.unknown()),
      targetId: z.string().optional(),
    })),
    applied: z.array(z.object({
      code: z.string(),
      params: z.record(z.string(), z.unknown()).optional(),
      targetId: z.string().optional(),
    })),
  }),
});

function parseSnapshot(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return parseRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return parseRecord(value);
}

function toBooleanRecord(value: unknown): Record<string, boolean> {
  const rec = parseRecord(value);
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = Boolean(v);
  return out;
}

function actorFromRequest(req: { user?: Express.UserTokenPayload }) {
  const user = req.user;
  return {
    id: user && typeof user.id === 'string' ? user.id : undefined,
    role: user && typeof user.role === 'string' ? user.role : undefined,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function registerPolicyCoverageRoutes(router: Router) {
  router.get('/:id/coverage-options-view', policyCoverageAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const [policy, currentState, activeInstances] = await Promise.all([
        tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, select: { id: true, programId: true, binderId: true, productType: true, quoteData: true } }),
        tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId } }),
        tenantScopedPrisma.endorsementInstance.findMany({
          where: { policyId, status: { in: ['APPLIED', 'PENDING'] } },
          orderBy: { createdAt: 'desc' },
          select: { code: true, targetId: true, premiumDelta: true, status: true },
        }),
      ]);

      if (!policy) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
      }

      const productType = String(policy.productType || '').trim().toUpperCase();
      if (!productType) {
        return res.status(400).json({ success: false, error: { code: 'PRODUCT_TYPE_REQUIRED', message: 'Policy has no product type.' } });
      }
      if (!productAdapterExists(productType)) {
        return res.status(400).json({ success: false, error: { code: 'PRODUCT_ADAPTER_MISSING', message: `No product adapter for ${productType}` } });
      }

      const snapshot = currentState ? parseSnapshot(jsonParse(currentState.snapshot)) : {};
      const effectiveQuoteData = resolveEffectiveQuoteData({ snapshot, policyQuoteData: policy.quoteData });
      const stored = parseRecord(snapshot.coverageSelection);
      const programId = String(policy.programId || '').trim();

      if (!programId) {
        const empty = CoverageOptionsViewResponseSchema.parse({
          sections: [],
          savedSelection: {
            schemaVersion: 1,
            programId: null,
            programCode: null,
            selected: {},
            params: {},
            requiresProgram: true,
            defaults: { selected: {}, params: {} },
            resolvedCoverageSet: {
              productType,
              programCode: '',
              selectedCodes: [],
              items: [],
              applied: [],
            },
          },
          resolvedCoverageSet: {
            productType,
            programCode: '',
            selectedCodes: [],
            items: [],
            applied: [],
          },
        });
        return res.json({ success: true, data: empty });
      }

      const cfg = await resolveProgrammeCoverageConfiguration({ programId, binderId: String(policy.binderId || ''), productType });
      const contract = resolveCoverageContractForHttp({
        productType,
        quoteData: effectiveQuoteData,
        cfg,
        storedSelection: stored,
        programId,
        boInitialized: parseCoverageSelectionForHttp(stored).bo_initialized === true,
      });
      const view = CoverageOptionsViewResponseSchema.parse(
        buildCoverageOptionsViewForProduct({
          productType,
          programCode: String(contract.programCode || ''),
          contract,
          activeInstances: activeInstances.map((instance) => ({
            ...instance,
            premiumDelta: Number(instance.premiumDelta || 0),
          })),
          quoteData: effectiveQuoteData,
        }),
      );

      return res.json({ success: true, data: view });
    } catch (error) {
      logger.error({ err: error }, 'Get coverage options view error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to get coverage options view') } });
    }
  });

  /**
   * GET /api/policies/:id/coverage-selection
   * Returns the merged selection: program defaults + policy overrides (stored in PolicyStateCurrent.snapshot.coverageSelection).
   */
  router.get('/:id/coverage-selection', policyCoverageAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;

      const [policy, currentState] = await Promise.all([
        tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, select: { id: true, programId: true, binderId: true, productType: true, quoteData: true } }),
        tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId } }),
      ]);

      if (!policy) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
      }
      const programId = String(policy.programId || '').trim();
      if (!programId) {
        // Production hardening: customer/BO flows may call this endpoint before a Program is selected.
        // Returning 400 breaks the UI; return a safe empty selection instead.
        const safeResponse = CoverageSelectionResponseSchema.parse({
          schemaVersion: 1,
          programId: null,
          programCode: null,
          selected: {},
          params: {},
          defaults: { selected: {}, params: {} },
          resolvedCoverageSet: {
            productType: String(policy.productType || '').toUpperCase() || 'UNKNOWN',
            programCode: '',
            selectedCodes: [],
            items: [],
            applied: [],
          },
          requiresProgram: true,
        });
        return res.json({
          success: true,
          data: safeResponse,
        });
      }

      const snapshot = currentState ? parseSnapshot(jsonParse(currentState.snapshot)) : {};
      const stored = parseRecord(snapshot.coverageSelection);
      const effectiveQuoteData = resolveEffectiveQuoteData({ snapshot, policyQuoteData: policy.quoteData });

      const cfg = await resolveProgrammeCoverageConfiguration({ programId, binderId: String(policy.binderId || ''), productType: String(policy.productType || '') });
      const safeResponse = CoverageSelectionResponseSchema.parse(
        resolveCoverageContractForHttp({
          productType: String(policy.productType || ''),
          quoteData: effectiveQuoteData,
          cfg,
          storedSelection: stored,
          programId,
          boInitialized: parseCoverageSelectionForHttp(stored).bo_initialized === true,
        })
      );

      return res.json({
        success: true,
        data: safeResponse,
      });
    } catch (error) {
      logger.error({ err: error }, 'Get coverage selection error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to get coverage selection') } });
    }
  });

  /**
   * POST /api/policies/:id/coverage-selection/init
   * One-time initialisation: uses resolveAppliedEndorsementsForQuote (the single MBE brain)
   * to write the correct default selection for this policy. No-ops if already initialised
   * so underwriter opt-out choices made after first init are preserved.
   */
  router.post('/:id/coverage-selection/init', policyCoverageAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;

      const [policy, currentState] = await Promise.all([
        tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, select: { id: true, programId: true, binderId: true, productType: true, quoteData: true } }),
        tenantScopedPrisma.policyStateCurrent.findUnique({ where: { policyId } }),
      ]);

      if (!policy) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
      }

      const programId = String(policy.programId || '').trim();
      if (!programId) {
        return res.json({ success: true, data: { skipped: true, reason: 'no_program' } });
      }

      const snapshot = currentState ? parseSnapshot(jsonParse(currentState.snapshot)) : {};
      const stored = parseRecord(snapshot.coverageSelection);
      const effectiveQuoteData = resolveEffectiveQuoteData({ snapshot, policyQuoteData: policy.quoteData });
      const normalizedStored = parseCoverageSelectionForHttp(stored);

      // Idempotency: only initialise once; subsequent UW changes use PUT to save overrides.
      if (normalizedStored.bo_initialized === true) {
        const cfg = await resolveProgrammeCoverageConfiguration({ programId, binderId: String(policy.binderId || ''), productType: String(policy.productType || '') });
        const currentContract = CoverageSelectionResponseSchema.parse(
          resolveCoverageContractForHttp({
            productType: String(policy.productType || ''),
            quoteData: effectiveQuoteData,
            cfg,
            storedSelection: stored,
            programId,
            boInitialized: true,
          })
        );
        return res.json({ success: true, data: currentContract });
      }

      const cfg = await resolveProgrammeCoverageConfiguration({ programId, binderId: String(policy.binderId || ''), productType: String(policy.productType || '') });
      const initContract = resolveCoverageContractForHttp({
        productType: String(policy.productType || ''),
        quoteData: effectiveQuoteData,
        cfg,
        storedSelection: {
          ...normalizedStored,
          selected: {},
        },
        programId,
        source: normalizedStored.source || 'BO_INIT',
        boInitialized: true,
      });
      const initSnapshot = normalizeCoverageSelectionForHttp({
        value: {
          ...normalizedStored,
          programId,
          programCode: initContract.programCode,
          selected: initContract.defaults.selected,
          source: normalizedStored.source || 'BO_INIT',
        },
        programId,
        programCode: initContract.programCode,
        allowedCodes: Object.keys(initContract.selected),
        source: normalizedStored.source || 'BO_INIT',
        updatedAt: new Date().toISOString(),
        boInitialized: true,
      });

      const updated = await runTenantScopedTransaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        const state = await tx.policyStateCurrent.findUnique({ where: { policyId } });
        const prev = state ? parseSnapshot(jsonParse(state.snapshot)) : {};
        const nextSnapshot = {
          ...(prev || {}),
          coverageSelection: initSnapshot,
        };
        await persistWorkspaceSnapshot(tx, { policyId, riskTransactionId: null, nextSnapshot });
        return parseRecord(nextSnapshot.coverageSelection);
      });

      const actor = actorFromRequest(req);
      await AuditLogger.log(policyId, 'POLICY', 'POLICY.COVERAGE_SELECTION.SAVED', actor?.id || 'system', actor?.role ? 'USER' : 'SYSTEM', { programId, programCode: initContract.programCode, selectedCount: Object.values(initSnapshot.selected).filter(Boolean).length, init: true });

      return res.json({
        success: true,
        data: CoverageSelectionResponseSchema.parse(
          resolveCoverageContractForHttp({
            productType: String(policy.productType || ''),
            quoteData: effectiveQuoteData,
            cfg,
            storedSelection: updated,
            programId,
            boInitialized: true,
          })
        ),
      });
    } catch (error) {
      logger.error({ err: error }, 'Init coverage selection error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to initialise coverage selection') } });
    }
  });

  /**
   * PUT /api/policies/:id/coverage-selection
   * Saves policy overrides (selected + params) for the current program.
   */
  router.put('/:id/coverage-selection', policyCoverageAuditLog, async (req, res) => {
    try {
      const { id: policyId } = req.params;
      const parsedPayload = CoverageSelectionBodySchema.safeParse(req.body);
      const payload = parsedPayload.success ? parsedPayload.data : {};
      const riskTransactionIdRaw = payload.riskTransactionId;
      const riskTransactionId = riskTransactionIdRaw ? String(riskTransactionIdRaw) : null;

      const policy = await tenantScopedPrisma.policy.findUnique({ where: { id: policyId }, select: { id: true, programId: true, binderId: true, productType: true, status: true } });
      if (!policy) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Policy not found' } });
      }
      if (isIssuedLifecycleStatus(String(policy.status || '')) && !riskTransactionId) {
        return res.status(403).json({
          success: false,
          error: { code: 'POLICY_IMMUTABLE', message: 'Issued policies are immutable. Create an endorsement draft to modify coverages.' },
        });
      }
      const programId = String(policy.programId || '').trim();
      if (!programId) {
        // Allow saving a temporary selection even before program is set.
        // UI can carry this forward once a program is selected.
        const nextSnapshot = normalizeCoverageSelectionForHttp({
          value: {
            selected: toBooleanRecord(payload.selected),
            params: parseRecord(payload.params),
          },
          programId: null,
          programCode: null,
          source: 'TEMP_SELECTION',
          updatedAt: new Date().toISOString(),
          requiresProgram: true,
        });

        const updated = await runTenantScopedTransaction(async (_tx) => {
          const tx = _tx as unknown as Prisma.TransactionClient;
          if (riskTransactionId) {
            await assertEndorsementDraftRiskTransaction(tx, { policyId, riskTransactionId });
          }
          const state = await tx.policyStateCurrent.findUnique({ where: { policyId } });
          const prev = state ? parseSnapshot(jsonParse(state.snapshot)) : {};
          const nextStateSnapshot = {
            ...(prev || {}),
            coverageSelection: nextSnapshot,
          };

          await persistWorkspaceSnapshot(tx, { policyId, riskTransactionId, nextSnapshot: nextStateSnapshot });
          return parseRecord(nextStateSnapshot.coverageSelection);
        });

        return res.json({
          success: true,
          data: CoverageSelectionResponseSchema.parse({
            ...updated,
            defaults: { selected: {}, params: {} },
            applied: [],
          }),
        });
      }

      const cfg = await resolveProgrammeCoverageConfiguration({ programId, binderId: String(policy.binderId || ''), productType: String(policy.productType || '') });
      const normalizedPayload = normalizeCoverageSelectionForHttp({
        value: {
          ...parseCoverageSelectionForHttp(payload),
          selected: toBooleanRecord(payload.selected),
          params: parseRecord(payload.params),
          source: 'USER_SELECTION',
        },
        programId,
        programCode: cfg.programCode,
        allowedCodes: [...(cfg.base || []).map((item) => String(item.code || '')), ...(cfg.options || []).map((item) => String(item.code || ''))],
        source: 'USER_SELECTION',
        updatedAt: new Date().toISOString(),
      });

      const updated = await runTenantScopedTransaction(async (_tx) => {
        const tx = _tx as unknown as Prisma.TransactionClient;
        if (riskTransactionId) {
          await assertEndorsementDraftRiskTransaction(tx, { policyId, riskTransactionId });
        }
        const state = await tx.policyStateCurrent.findUnique({ where: { policyId } });
        const prev = state ? parseSnapshot(jsonParse(state.snapshot)) : {};
        const nextSnapshot = {
          ...(prev || {}),
          coverageSelection: normalizedPayload,
        };

        await persistWorkspaceSnapshot(tx, { policyId, riskTransactionId, nextSnapshot });

        return parseRecord(nextSnapshot.coverageSelection);
      });

      // Best-effort audit
      const actor = actorFromRequest(req);
      await AuditLogger.log(
        policyId,
        'POLICY',
        'POLICY.COVERAGE_SELECTION.SAVED',
        actor?.id || 'system',
        actor?.role ? 'USER' : 'SYSTEM',
        { programId, programCode: cfg.programCode, selectedCount: Object.values(normalizedPayload.selected).filter(Boolean).length }
      );

      const policyWithQuoteData = await tenantScopedPrisma.policy.findUnique({
        where: { id: policyId },
        select: { quoteData: true, productType: true, stateCurrent: { select: { snapshot: true } } },
      });
      const latestSnapshot = parseSnapshot(jsonParse(policyWithQuoteData?.stateCurrent?.snapshot));
      const effectiveQuoteData = resolveEffectiveQuoteData({
        snapshot: latestSnapshot,
        policyQuoteData: policyWithQuoteData?.quoteData,
      });
      return res.json({
        success: true,
        data: CoverageSelectionResponseSchema.parse(
          resolveCoverageContractForHttp({
            productType: String(policyWithQuoteData?.productType || ''),
            quoteData: effectiveQuoteData,
            cfg,
            storedSelection: updated,
            programId,
            source: normalizedPayload.source,
          })
        ),
      });
    } catch (error) {
      logger.error({ err: error }, 'Save coverage selection error:');
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: errorMessage(error, 'Failed to save coverage selection') } });
    }
  });
}
