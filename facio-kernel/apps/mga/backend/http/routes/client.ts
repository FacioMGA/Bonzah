import { Router } from 'express';

import policiesRouter from './policies.js';
import clientClaimsRouter from './clientClaimsRouter.js';
import documentsRouter from './documents.js';
import { requireSurfaceAccess, resolveRequestSurface } from '../middleware/surfaceGate.js';

export function createClientApiRouter() {
  const router = Router();
  router.use(requireSurfaceAccess(['client', 'bo']));
  router.use('/policies', policiesRouter);
  // Customer policy documents use the same secured binary router as BO. Keep
  // the mount client-only so BO requests continue through their requireBO and
  // permission-gated route below in the composed API router.
  router.use('/documents', (req, res, next) => {
    if (resolveRequestSurface(req) !== 'client') return next('router');
    if (req.method !== 'GET') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only document viewing and downloading are available on the customer portal.',
        },
      });
    }
    return documentsRouter(req, res, next);
  });
  // Client-surface claims only. BO /api/claims must still reach the worksheet
  // router, so non-client surfaces skip this mount (`next('router')`).
  router.use('/claims', (req, _res, next) => {
    if (resolveRequestSurface(req) !== 'client') return next('router');
    return next();
  }, clientClaimsRouter);
  return router;
}
