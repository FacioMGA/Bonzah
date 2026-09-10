import { RequestHandler, Router } from 'express';

import { createPublicApiRouter } from './routes/public.js';
import { createClientApiRouter } from './routes/client.js';
import { createBoApiRouter } from './routes/bo.js';
import { authenticate } from '../platform/http/middleware/auth.js';
import { setAccountScopeContext } from './middleware/rls.js';
import { resolveOperatingTenant } from '../platform/http/middleware/resolveTenant.js';
import { sentryTenantScope } from '../platform/observability/sentryTenantScope.js';

export type ApiCompositionDeps = {
  publicLimiter: RequestHandler;
  protectedLimiter: RequestHandler;
  publicQuoteSessionLimiter: RequestHandler;
  publicApiLimiter: RequestHandler;
  publicApiDocsLimiter: RequestHandler;
  webhookLimiter: RequestHandler;
  readinessPollingLimiter: RequestHandler;
};

export function createApiRouter(deps: ApiCompositionDeps) {
  const router = Router();
  const {
    publicLimiter,
    protectedLimiter,
    publicQuoteSessionLimiter,
    publicApiLimiter,
    publicApiDocsLimiter,
    webhookLimiter,
    readinessPollingLimiter,
  } = deps;

  // MGA/jurisdiction tenant resolution — runs on every /api request so that
  // getTenantConfig() returns the correct per-jurisdiction values downstream.
  // Must be first so that both public and protected routes get the right config.
  router.use(resolveOperatingTenant);

  // Attribute every Sentry event on this request to the resolved tenant so the
  // shared backend project is filterable/alertable per territory. Runs after
  // tenant resolution (ALS bound) and before route handlers / the Sentry
  // express error handler.
  router.use(sentryTenantScope);

  router.use(
    createPublicApiRouter({
      publicLimiter,
      publicQuoteSessionLimiter,
      publicApiLimiter,
      publicApiDocsLimiter,
      webhookLimiter,
      readinessPollingLimiter,
    }),
  );

  router.use(protectedLimiter);
  router.use(authenticate);
  router.use(setAccountScopeContext);
  router.use(createClientApiRouter());
  router.use(createBoApiRouter());

  return router;
}
