/**
 * Product channel gate (ADR-0046).
 *
 * Enforces the per-tenant x product public-journey switches (questions / quote
 * / payment) at the public HTTP chokepoints. A logged-in Back Office user
 * bypasses an OFF switch; customers are refused with 403. Requires
 * `optionalAuthenticate` to have run first so `req.user` is populated.
 */
import type { NextFunction, Request, Response } from 'express';
import { isBackOfficeRequest } from '../../../platform/http/middleware/auth.js';
import {
  resolveProductChannel,
  type ProductChannelGate,
} from '../app/productChannel/resolveProductChannel.js';

function disabledMessage(gate: ProductChannelGate): string {
  if (gate === 'payment') {
    return 'Online payment is not available for this product. An advisor will contact you to complete your purchase.';
  }
  if (gate === 'quote') {
    return 'Online quoting is not available for this product right now. Please request a callback.';
  }
  return 'Online applications are not available for this product right now. Please request a callback.';
}

/**
 * Returns true when the request may proceed (gate ON, or a BO user bypassing).
 * On refusal it writes the 403 response and returns false.
 */
export async function enforceProductChannelGate(
  req: Request,
  res: Response,
  productCode: string,
  gate: ProductChannelGate,
): Promise<boolean> {
  if (isBackOfficeRequest(req)) return true;
  const channel = await resolveProductChannel(productCode);
  if (channel[gate]) return true;
  res.status(403).json({
    success: false,
    error: {
      code: 'PRODUCT_CHANNEL_DISABLED',
      message: disabledMessage(gate),
      details: { productCode: String(productCode || '').trim().toUpperCase(), gate },
    },
  });
  return false;
}

/**
 * Express middleware form for a statically-known product. Use on public routes
 * where the product is fixed by the router (motor) or the slug factory.
 */
export function productChannelGateMiddleware(productCode: string, gate: ProductChannelGate) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ok = await enforceProductChannelGate(req, res, productCode, gate);
    if (ok) next();
  };
}
