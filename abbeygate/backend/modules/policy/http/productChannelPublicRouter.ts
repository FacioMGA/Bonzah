/**
 * Public read-only projection of product channel switches (ADR-0046).
 *
 * GET /api/public/product-channels
 *   -> { success, data: { <slug>: { questions, quote, payment } } }
 *
 * The public wizard reads this to hide gated steps (questionnaire / quote /
 * payment) and show a referral completion when payment is OFF. Authoritative
 * enforcement still happens server-side at the session / rate / checkout gates;
 * this endpoint is a UX projection for the operating tenant.
 */
import { Router, type Request, type Response } from 'express';
import {
  resolveAllProductChannels,
  type ProductChannelCode,
} from '../app/productChannel/resolveProductChannel.js';
import { logger } from '../../../platform/utils/logger.js';

const SLUG_BY_CODE: Record<ProductChannelCode, string> = {
  MOTOR: 'motor',
  HOME: 'home',
  TRAVEL: 'travel',
  HEALTH: 'health',
  BUSINESS: 'business',
  OPEN_MARKET: 'open-market',
};

export function createProductChannelPublicRouter(): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const channels = await resolveAllProductChannels();
      const data: Record<string, { questions: boolean; quote: boolean; payment: boolean }> = {};
      for (const code of Object.keys(channels) as ProductChannelCode[]) {
        data[SLUG_BY_CODE[code]] = channels[code];
      }
      return res.json({ success: true, data });
    } catch (error) {
      logger.error({ err: error }, 'public product-channels projection failed');
      return res.status(500).json({ success: false, error: { message: 'Failed to load product channels' } });
    }
  });

  return router;
}
