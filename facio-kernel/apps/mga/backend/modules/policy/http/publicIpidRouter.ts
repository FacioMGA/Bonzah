import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { readRateLimitInt } from '../../../platform/http/middleware/rateLimit.js';
import { resolveProductIpidAsset } from '../app/productRegistryService.js';
import { logger } from '../../../platform/utils/logger.js';

// Public, unauthenticated route that reads a static PDF from disk — rate-limit
// it directly on the handler (defence-in-depth vs scraping / FS pressure).
const ipidLimiter = rateLimit({
  windowMs: readRateLimitInt('RATE_LIMIT_PUBLIC_WINDOW_MS', 15 * 60 * 1000),
  max: readRateLimitInt('RATE_LIMIT_PUBLIC_MAX', 100),
  standardHeaders: true,
  legacyHeaders: false,
});

// Products that expose an Insurance Product Information Document (IPID).
// Kept as an explicit allowlist so the route never probes
// the registry for arbitrary path segments.
const IPID_PRODUCT_SLUGS: Readonly<Record<string, string>> = {
  travel: 'TRAVEL',
  health: 'HEALTH',
  home: 'HOME',
  motor: 'MOTOR',
};

/**
 * Public, pre-purchase IPID endpoint (Peter, 2026-07-21). Serves the product's
 * static IPID PDF at quote stage so a customer can read it before buying. The
 * territory is taken from the operating tenant (resolved from Host), so Home
 * returns the correct per-territory IPID (ADR-0048). No policy/quote required.
 *
 *   GET /api/public/ipid/:productType   (productType ∈ travel|health|home|motor)
 */
export function createPublicIpidRouter(): Router {
  const router = Router();

  router.get('/:productType', ipidLimiter, (req, res) => {
    // Country alone cannot select another customer's legal document. Shared
    // Platform serves documents through an exact published policy/programme.
    if (process.env.KERNEL_PLATFORM_MODE === 'true') {
      return res.status(404).json({ success: false, error: { code: 'IPID_NOT_CONFIGURED', message: 'Select the IPID configured for this workspace and programme.' } });
    }
    const slug = String(req.params.productType || '').trim().toLowerCase();
    const productType = IPID_PRODUCT_SLUGS[slug];
    if (!productType) {
      return res.status(404).json({
        success: false,
        error: { code: 'IPID_NOT_AVAILABLE', message: 'No IPID is available for this product.' },
      });
    }

    const variant = req.query.variant;
    if (variant !== undefined && typeof variant !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_IPID_SELECTION', message: 'Specify one IPID variant.' },
      });
    }

    let asset: { absolutePath: string; filename: string } | null;
    try {
      const tenant = getTenantConfig();
      asset = resolveProductIpidAsset(productType, tenant.countryCode, { variant });
    } catch (error) {
      // Product-owned territory and variant validation fails closed.
      logger.warn({ err: error, productType }, 'IPID resolve failed for tenant territory');
      return res.status(404).json({
        success: false,
        error: { code: 'IPID_NOT_CONFIGURED', message: 'IPID is not available for this territory or product selection.' },
      });
    }

    if (!asset || !existsSync(asset.absolutePath)) {
      return res.status(404).json({
        success: false,
        error: { code: 'IPID_NOT_FOUND', message: 'IPID document not found.' },
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(asset.filename).replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    createReadStream(asset.absolutePath).pipe(res);
  });

  return router;
}
