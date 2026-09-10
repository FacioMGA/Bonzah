import express from 'express';
import { z } from 'zod';
import { getVehicleEnrichmentByVariantId, lookupVehicleVariants } from '../app/vehicleEnrichmentService.js';

const VariantsQuerySchema = z.object({
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  year: z.coerce.number().int().min(1900).max(2100),
});

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function createVehicleEnrichmentRouter() {
  const router = express.Router();

  router.get('/variants', async (req, res) => {
    const parsed = VariantsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.issues[0]?.message || 'Invalid variants query',
        },
      });
    }

    try {
      const options = await lookupVehicleVariants(parsed.data);
      return res.json({ success: true, data: { options } });
    } catch (error) {
      const message = errorMessage(error, 'Failed to load vehicle variants');
      // Fail-soft for provider quota/rate-limit outages so frontend can continue
      // with manual vehicle specification without surfacing hard API failures.
      if (/\b429\b|rate limit|limit of .*api_requests/i.test(message)) {
        return res.json({
          success: true,
          data: {
            options: [],
            degraded: true,
            reason: 'provider_rate_limited',
          },
        });
      }
      return res.status(502).json({
        success: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message,
        },
      });
    }
  });

  router.get('/variant/:variantId', async (req, res) => {
    const variantId = String(req.params.variantId || '').trim();
    if (!variantId) {
      return res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Missing variantId' },
      });
    }

    try {
      const enrichment = await getVehicleEnrichmentByVariantId(variantId);
      if (!enrichment) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Variant enrichment not found' },
        });
      }
      return res.json({ success: true, data: enrichment });
    } catch (error) {
      return res.status(502).json({
        success: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: errorMessage(error, 'Failed to load vehicle enrichment'),
        },
      });
    }
  });

  return router;
}
