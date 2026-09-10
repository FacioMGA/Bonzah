// FacioMGA - Reconciliation API Routes
// Handles payment matching and reconciliation

import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { reconciliationMatcher } from '../app/reconciliationMatcher.js';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { BankPayment } from '../../../platform/types/index.js';
import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { createRestrictedMemoryUpload } from '../../../platform/security/uploadPolicy.js';

import { logger } from '../../../platform/utils/logger.js';
import {
  errorMessage,
  sendError,
  requireTenantId,
  reconciliationTenantWhere,
} from './reconciliationUtils.js';
import { reconciliationImportHandler } from './reconciliationImportHandler.js';

const router = Router();
const upload = createRestrictedMemoryUpload({
  maxFileSizeBytes: 8 * 1024 * 1024,
  allowedMimeTypes: [
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  allowedExtensions: ['.csv', '.xlsx'],
});

// ─── Zod Schemas ─────────────────────────────────────────────────────

const MatchBodySchema = z.object({
  paymentReference: z.string().trim().min(1),
  paymentAmount: z.coerce.number(),
  paymentDate: z.union([z.string().datetime(), z.date()]),
  paymentMethod: z.enum(['ACH', 'WIRE', 'CHECK']),
  description: z.string().optional(),
  reconciliationId: z.string().trim().optional(),
});

const ReconciliationListQuerySchema = z.object({
  invoiceId: z.string().trim().optional(),
  policyId: z.string().trim().optional(),
  status: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

const ReconciliationIdParamsSchema = z.object({
  id: z.string().trim().min(1),
});

const ApplyBodySchema = z.object({
  invoiceId: z.string().trim().optional(),
});

const JournalQuerySchema = z.object({
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
});

const SearchInvoicesQuerySchema = z.object({
  query: z.string().trim().optional(),
  amount: z.coerce.number().optional(),
});

// ─── Middleware ───────────────────────────────────────────────────────

function paymentsAuditLog(req: Request, _res: Response, next: NextFunction): void {
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

// ─── POST /match ─────────────────────────────────────────────────────

export const matchPaymentHandler = async (req: Request, res: Response) => {
  try {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const {
      paymentReference,
      paymentAmount,
      paymentDate,
      paymentMethod,
      description,
      reconciliationId
    } = MatchBodySchema.parse(req.body);

    const payment: BankPayment = {
      reference: paymentReference,
      amount: paymentAmount,
      date: new Date(paymentDate),
      method: paymentMethod,
      description,
    };

    const invoices = await tenantScopedPrisma.invoice.findMany({
      where: {
        policy: { accountId: tenantId },
        status: { in: ['DRAFT', 'SENT', 'PARTIAL', 'OVERDUE'] },
      },
      include: {
        policy: {
          include: {
            policyHolder: true
          }
        }
      }
    });

    logger.info('=== RECONCILIATION MATCH DEBUG ===');
    logger.info({ count: invoices.length }, 'Fetched invoices count');
    logger.info({
      invoices: invoices.map(i => ({
        id: i.id.substring(0, 8),
        amount: i.amount,
        status: i.status
      }))
    }, 'Invoice details');
    logger.info({
      ref: payment.reference,
      amount: payment.amount
    }, 'Payment');

    const suggestions = reconciliationMatcher.getSuggestedMatches(payment, invoices);
    logger.info({ count: suggestions.length }, 'Suggestions returned');
    const bestMatch = suggestions[0];
    logger.info('=== END DEBUG ===');

    let reconciliation;
    if (reconciliationId) {
      reconciliation = await tenantScopedPrisma.reconciliation.update({
        where: { id: reconciliationId },
        data: {
          invoiceId: bestMatch?.invoiceId || null,
          matchedAmount: bestMatch?.matchedAmount || 0,
          status: bestMatch ? 'UNAPPLIED' : 'EXCEPTION',
          exceptionNotes: bestMatch ? undefined : 'No matching invoice found',
        }
      });
    } else {
      reconciliation = await tenantScopedPrisma.reconciliation.create({
        data: {
          invoiceId: bestMatch?.invoiceId || undefined,
          paymentReference,
          paymentAmount,
          paymentDate: payment.date,
          paymentMethod,
          status: bestMatch ? 'UNAPPLIED' : 'EXCEPTION',
          matchedAmount: bestMatch?.matchedAmount || 0,
          exceptionNotes: bestMatch ? undefined : 'No matching invoice found',
        } as unknown as Prisma.ReconciliationUncheckedCreateInput,
      });
    }

    return res.json({
      success: true,
      data: {
        reconciliation,
        match: bestMatch || { invoiceId: '', matchType: 'EXCEPTION', matchedAmount: 0, tolerance: 0, confidence: 0, notes: 'No match found' },
        suggestions,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'MISSING_FIELDS', error.issues[0]?.message || 'Invalid payment payload');
    }
    logger.error({ err: error }, 'Match payment error:');
    return sendError(res, 500, 'MATCHING_ERROR', errorMessage(error, 'Payment matching failed'));
  }
};

router.post('/match', paymentsAuditLog, matchPaymentHandler);

// ─── GET / ───────────────────────────────────────────────────────────

router.get('/', paymentsAuditLog, async (req, res) => {
  try {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const { invoiceId, policyId, status, page, pageSize } = ReconciliationListQuerySchema.parse(req.query);

    const where: Record<string, unknown> = {};
    if (invoiceId) where.invoiceId = invoiceId;
    if (policyId) where.policyId = policyId;
    if (status) where.status = status;

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const tenantWhere = reconciliationTenantWhere(tenantId);
    const scopedWhere = {
      AND: [where, tenantWhere],
    };
    const [reconciliations, total] = await Promise.all([
      tenantScopedPrisma.reconciliation.findMany({
        where: scopedWhere,
        include: { invoice: true, policy: true, payment: true },
        skip,
        take,
        orderBy: { paymentDate: 'desc' },
      }),
      tenantScopedPrisma.reconciliation.count({ where: scopedWhere }),
    ]);

    return res.json({
      success: true,
      data: reconciliations,
      pagination: {
        page: Number(page),
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid query');
    }
    logger.error({ err: error }, 'List reconciliations error:');
    return sendError(res, 500, 'SERVER_ERROR', errorMessage(error, 'Failed to list reconciliations'));
  }
});

// ─── POST /:id/apply ─────────────────────────────────────────────────

router.post('/:id/apply', paymentsAuditLog, async (req, res) => {
  try {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const { id } = ReconciliationIdParamsSchema.parse(req.params);
    const { invoiceId } = ApplyBodySchema.parse(req.body);

    if (invoiceId) {
      const existing = await tenantScopedPrisma.reconciliation.findFirst({
        where: {
          id,
          ...reconciliationTenantWhere(tenantId),
        },
        select: { id: true },
      });
      if (!existing) {
        return sendError(res, 404, 'NOT_FOUND', 'Reconciliation not found');
      }
      await tenantScopedPrisma.reconciliation.update({
        where: { id },
        data: {
          invoiceId,
          status: 'UNAPPLIED'
        }
      });
    }

    const reconciliation = await tenantScopedPrisma.reconciliation.findFirst({
      where: {
        id,
        ...reconciliationTenantWhere(tenantId),
      },
    });
    if (!reconciliation) {
      return sendError(res, 404, 'NOT_FOUND', 'Reconciliation not found');
    }

    if (!reconciliation.invoiceId) {
      return sendError(res, 400, 'NO_INVOICE', 'Reconciliation must be matched to an invoice');
    }

    logger.info(`[Reconciliation] Applying match for RecID: ${id}, InvoiceID: ${invoiceId || reconciliation.invoiceId}`);

    const invoice = await tenantScopedPrisma.invoice.findUnique({
      where: { id: reconciliation.invoiceId },
      include: {
        policy: {
          include: {
            policyHolder: true
          }
        }
      }
    });
    if (!invoice) {
      logger.error(`[Reconciliation] Invoice not found: ${reconciliation.invoiceId}`);
      return sendError(res, 404, 'INVOICE_NOT_FOUND', 'Invoice not found');
    }
    if (String(invoice.policy?.accountId || '') !== tenantId) {
      return sendError(res, 404, 'INVOICE_NOT_FOUND', 'Invoice not found');
    }

    const validation = reconciliationMatcher.validateReconciliation(reconciliation);
    logger.info({ reconciliationId: id, validation }, 'Reconciliation validation result');

    if (!validation.isValid) {
      logger.error(`[Reconciliation] Validation failed: ${validation.errors.join(', ')}`);
      return sendError(res, 400, 'VALIDATION_ERROR', validation.errors.join(', '));
    }

    const updatedReconciliation = await reconciliationMatcher.reconcilePayment(reconciliation, invoice);

    return res.json({
      success: true,
      data: updatedReconciliation,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid request');
    }
    logger.error({ err: error }, 'Apply reconciliation error:');
    return sendError(res, 500, 'APPLICATION_ERROR', errorMessage(error, 'Failed to apply reconciliation'));
  }
});

// ─── GET /journal ────────────────────────────────────────────────────

router.get('/journal', paymentsAuditLog, async (req, res) => {
  try {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const { periodStart, periodEnd } = JournalQuerySchema.parse(req.query);

    const where: Record<string, unknown> = {};
    if (periodStart && periodEnd) {
      where.paymentDate = {
        gte: new Date(periodStart),
        lte: new Date(periodEnd),
      };
    }

    const reconciliations = await tenantScopedPrisma.reconciliation.findMany({
      where: {
        AND: [where, reconciliationTenantWhere(tenantId)],
      },
      include: { invoice: true },
      orderBy: { paymentDate: 'desc' }
    });

    const journal = await reconciliationMatcher.exportReconciliationJournal(reconciliations);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="reconciliation-journal.csv"');
    return res.send(journal);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendError(res, 400, 'VALIDATION_ERROR', error.issues[0]?.message || 'Invalid query');
    }
    logger.error({ err: error }, 'Export journal error:');
    return sendError(res, 500, 'EXPORT_ERROR', errorMessage(error, 'Failed to export journal'));
  }
});

// ─── GET /invoices/search ────────────────────────────────────────────

router.get('/invoices/search', paymentsAuditLog, async (req, res) => {
  try {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const { query } = SearchInvoicesQuerySchema.parse(req.query);

    const where: Record<string, unknown> = {
      policy: { accountId: tenantId },
      status: { in: ['DRAFT', 'SENT', 'PARTIAL', 'OVERDUE'] },
    };

    if (query) {
      where.OR = [
        { id: { contains: query } },
        { policy: { policyHolder: { name: { contains: query } } } }
      ];
    }

    const invoices = await tenantScopedPrisma.invoice.findMany({
      where,
      include: {
        policy: {
          include: {
            policyHolder: true
          }
        }
      },
      take: 10,
      orderBy: { createdAt: 'desc' }
    });

    return res.json({
      success: true,
      data: invoices
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.issues[0]?.message || 'Invalid query' } });
    }
    logger.error({ err: error }, 'Invoice search error:');
    return res.status(500).json({
      success: false,
      error: {
        code: 'SEARCH_ERROR',
        message: errorMessage(error, 'Invoice search failed')
      }
    });
  }
});

// ─── POST /import ────────────────────────────────────────────────────

router.post('/import', paymentsAuditLog, upload.single('file'), reconciliationImportHandler);

export default router;
