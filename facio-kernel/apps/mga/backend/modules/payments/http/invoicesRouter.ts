// FacioMGA - Invoices API Routes

import { Router } from 'express';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { paymentsAuditLog } from './paymentsAuditMiddleware.js';
import { z } from 'zod';
import { enqueuePolicyIndexFromPayments } from '../app/policyIndexUpdate.js';
import { enqueueAccountProjectionRefreshByPolicyId } from '../../accounts360/app/accountProjectionRefresh.js';

import { logger } from '../../../platform/utils/logger.js';
const router = Router();

const IdParamSchema = z.object({
  id: z.string().trim().min(1, 'id is required'),
});
const InvoicesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.string().trim().optional(),
  policyId: z.string().trim().optional(),
  search: z.string().trim().optional(),
});

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// GET /api/invoices
router.get('/', paymentsAuditLog, async (req, res) => {
  try {
    const tenantId = String(req.tenantId || '').trim();
    if (!tenantId) {
      return res.status(401).json({ success: false, error: { code: 'TENANT_REQUIRED', message: 'Authenticated tenant context is missing' } });
    }
    const { page, pageSize, status, policyId, search } = InvoicesListQuerySchema.parse(req.query || {});
    const where: Record<string, unknown> = {
      policy: {
        accountId: tenantId,
      },
    };
    if (status) where.status = status;
    if (policyId) where.policyId = policyId;
    if (search) {
      where.OR = [
        { id: { contains: search } },
        { status: { contains: search, mode: 'insensitive' } },
        { policy: { policyNumber: { contains: search, mode: 'insensitive' } } },
        { policy: { policyHolder: { name: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    const [invoices, total] = await Promise.all([
      tenantScopedPrisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          policyId: true,
          amount: true,
          currency: true,
          status: true,
          dueDate: true,
          paidDate: true,
          createdAt: true,
          updatedAt: true,
          policy: {
            select: {
              policyNumber: true,
              policyHolder: { select: { id: true, name: true, contact: true } },
            },
          },
        },
      }),
      tenantScopedPrisma.invoice.count({ where }),
    ]);

    const mapped = invoices.map((inv) => ({
      ...inv,
      landlord: inv.policy?.policyHolder,
      amount: Number(inv.amount),
    }));

    return res.json({
      success: true,
      data: mapped,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.issues[0]?.message || 'Invalid query' });
    }
    return res.status(500).json({ success: false, error: errorMessage(error, 'Failed to list invoices') });
  }
});

// GET /api/invoices/:id
router.get('/:id', paymentsAuditLog, async (req, res) => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    const invoice = await tenantScopedPrisma.invoice.findUnique({
      where: { id },
      include: { reconciliations: true },
    });
    if (!invoice) return res.status(404).json({ success: false, error: 'Not Found' });
    return res.json({ success: true, data: invoice });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid invoice id' });
    }
    return res.status(500).json({ success: false, error: errorMessage(error, 'Failed to load invoice') });
  }
});

// DELETE /api/invoices/:id
router.delete('/:id', paymentsAuditLog, async (req, res) => {
  try {
    const { id } = IdParamSchema.parse(req.params);
    const invoice = await tenantScopedPrisma.invoice.findUnique({ where: { id } });

    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });
    if (['PAID', 'SETTLED'].includes(invoice.status)) {
      return res.status(400).json({ success: false, error: 'Cannot delete PAID or SETTLED invoices.' });
    }

    await tenantScopedPrisma.invoice.delete({ where: { id } });
    if (typeof invoice.policyId === 'string' && invoice.policyId.trim().length > 0) {
      await enqueuePolicyIndexFromPayments(prisma, invoice.policyId);
      await enqueueAccountProjectionRefreshByPolicyId(prisma, invoice.policyId);
    }

    return res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid invoice id' });
    }
    logger.error({ err: error }, 'Delete invoice error:');
    return res.status(500).json({ success: false, error: 'Failed to delete invoice' });
  }
});

export default router;
