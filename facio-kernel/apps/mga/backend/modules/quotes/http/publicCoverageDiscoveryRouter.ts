import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../../../platform/utils/logger.js';
import { discoverRentalCoverages } from '../../../products/rental/pricing/calculator.js';

/**
 * Pre-quote coverage discovery for public distribution surfaces.
 *
 * A distribution partner asks "what may this renter buy here" before any quote
 * identity exists. Eligibility, dependencies, limits and indicative prices are
 * all resolved in the kernel and returned whole, so a static partner page never
 * reproduces rating or eligibility in frontend code and never needs a
 * privileged key to ask the question.
 *
 * This route creates nothing and retains nothing: no quote, no session, no
 * customer record. It is safe to call repeatedly and safe to call anonymously.
 */

const vehicleSchema = z.object({
  id: z.string().optional(),
  year: z.number().int().min(1900).max(2100),
  make: z.string().min(1).max(64),
  model: z.string().min(1).max(64),
  class: z.enum(['compact', 'sedan', 'suv']),
  declaredValue: z.number().nonnegative().max(10_000_000),
  repairProfile: z.enum(['low', 'standard', 'high']),
  powertrain: z.enum(['combustion', 'hybrid', 'ev']),
});

const usState = z.string().trim().length(2).regex(/^[A-Za-z]{2}$/, 'Expected a two-letter US state code');

const discoveryRequestSchema = z.object({
  pickup: z.object({ country: z.literal('US'), state: usState, location: z.string().max(200).optional() }),
  residence: z.object({ country: z.literal('US'), state: usState }).optional(),
  rentalStart: z.string().min(1),
  rentalEnd: z.string().min(1),
  driver: z.object({ age: z.number().int().min(0).max(120), licenceValid: z.boolean() }),
  rentalUse: z.enum(['PERSONAL', 'COMMERCIAL', 'RIDESHARE_OR_DELIVERY']),
  vehicle: vehicleSchema.optional(),
});

/**
 * Only products that implement discovery are mounted. Adding a product here is
 * deliberate rather than automatic: a product without an eligibility engine
 * would otherwise answer an availability question it cannot actually decide.
 */
const discoveryByProduct: Record<string, (input: z.infer<typeof discoveryRequestSchema>) => unknown> = {
  RENTAL: (input) => discoverRentalCoverages(input),
};

export function productSupportsCoverageDiscovery(productType: string): boolean {
  return Boolean(discoveryByProduct[productType.toUpperCase()]);
}

export function createPublicCoverageDiscoveryRouter(productType: string): Router {
  const router = Router();
  const discover = discoveryByProduct[productType.toUpperCase()];

  router.post('/', (req: Request, res: Response) => {
    if (!discover) {
      res.status(404).json({ error: { code: 'DISCOVERY_UNSUPPORTED', message: `${productType} does not support coverage discovery.` } });
      return;
    }
    const parsed = discoveryRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'INVALID_DISCOVERY_REQUEST',
          message: 'The coverage discovery request is invalid.',
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        },
      });
      return;
    }
    try {
      // An ineligible renter is a successful answer, not an error: the engine
      // returns the decision and the caller renders it.
      res.status(200).json(discover(parsed.data));
    } catch (error) {
      logger.error({ err: error, productType }, 'public coverage discovery failed');
      res.status(500).json({ error: { code: 'DISCOVERY_FAILED', message: 'Coverage discovery could not be completed.' } });
    }
  });

  return router;
}
