import { Router } from 'express';

import policiesRouter from './policies.js';
import clientClaimsRouter from './clientClaimsRouter.js';
import { requireSurfaceAccess, resolveRequestSurface } from '../middleware/surfaceGate.js';

export function createClientApiRouter() {
  const router = Router();
  router.use(requireSurfaceAccess(['client', 'bo']));
  router.use('/policies', policiesRouter);
  // Client-surface claims only. BO /api/claims must still reach the worksheet
  // router, so non-client surfaces skip this mount (`next('router')`).
  router.use('/claims', (req, _res, next) => {
    if (resolveRequestSurface(req) !== 'client') return next('router');
    return next();
  }, clientClaimsRouter);
  return router;
}
