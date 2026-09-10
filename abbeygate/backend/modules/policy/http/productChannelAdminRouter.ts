/**
 * Back Office admin router for product channel switches (ADR-0046).
 *
 * GET  /api/product-channels            -> effective switches for the active tenant
 * PUT  /api/product-channels/:productCode -> upsert a product's switches
 *
 * Mounted behind `requireBO` + `requirePermission('settings','view')`. The
 * switches live in their own tenant-scoped table read fresh on every public
 * request, so a save here takes effect immediately (no tenant-config cache).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { WithoutTenantScope } from '../../../platform/db/tenantExtension.js';
import {
  PRODUCT_CHANNEL_CODES,
  resolveAllProductChannels,
  type ProductChannelCode,
} from '../app/productChannel/resolveProductChannel.js';
import { logger } from '../../../platform/utils/logger.js';

const switchesSchema = z.object({
  questions: z.boolean(),
  quote: z.boolean(),
  payment: z.boolean(),
});

function isKnownProduct(code: string): code is ProductChannelCode {
  return (PRODUCT_CHANNEL_CODES as readonly string[]).includes(code);
}

export function createProductChannelAdminRouter(): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const channels = await resolveAllProductChannels();
      return res.json({ success: true, data: channels });
    } catch (error) {
      logger.error({ err: error }, 'product channel admin: list failed');
      return res.status(500).json({ success: false, error: { message: 'Failed to load product channels' } });
    }
  });

  router.put('/:productCode', async (req: Request, res: Response) => {
    try {
      const productCode = String(req.params.productCode || '').trim().toUpperCase();
      if (!isKnownProduct(productCode)) {
        return res.status(400).json({ success: false, error: { code: 'UNKNOWN_PRODUCT', message: `Unknown product ${productCode}` } });
      }
      const parsed = switchesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'questions, quote and payment booleans are required' } });
      }
      const { questions, quote, payment } = parsed.data;

      const existing = await tenantScopedPrisma.productChannelSetting.findFirst({ where: { productCode } });
      if (existing) {
        await tenantScopedPrisma.productChannelSetting.update({
          where: { id: existing.id },
          data: { questionsEnabled: questions, quoteEnabled: quote, paymentEnabled: payment },
        });
      } else {
        const createData: WithoutTenantScope<Prisma.ProductChannelSettingUncheckedCreateInput> = {
          productCode,
          questionsEnabled: questions,
          quoteEnabled: quote,
          paymentEnabled: payment,
        };
        await tenantScopedPrisma.productChannelSetting.create({
          data: createData as Prisma.ProductChannelSettingUncheckedCreateInput,
        });
      }

      const channels = await resolveAllProductChannels();
      return res.json({ success: true, data: channels });
    } catch (error) {
      logger.error({ err: error }, 'product channel admin: update failed');
      return res.status(500).json({ success: false, error: { message: 'Failed to save product channel' } });
    }
  });

  return router;
}
