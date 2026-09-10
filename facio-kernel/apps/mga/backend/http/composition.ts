import { RequestHandler, Router } from 'express';

import { createPublicApiRouter } from './routes/public.js';
import { createClientApiRouter } from './routes/client.js';
import { createBoApiRouter } from './routes/bo.js';
import { authenticate } from '../platform/http/middleware/auth.js';
import { setAccountScopeContext } from './middleware/rls.js';
import { resolveOperatingTenant } from '../platform/http/middleware/resolveTenant.js';
import { sentryTenantScope } from '../platform/observability/sentryTenantScope.js';
import { prisma } from '../platform/db/connection.js';
import { createPlatformTenantService } from '../modules/platformTenants/index.js';
import { createPlatformRouter } from './routes/platform.js';
import { createPlatformTenantAccess } from './middleware/platformTenantAccess.js';
import { loginRouter } from '../modules/auth/http/authRouter/loginRoute.js';
import { createPlatformMcpRouter } from '../modules/mcp/http/platformMcpRouter.js';

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
  let platformTenantAccess: RequestHandler | null = null;
  const {
    publicLimiter,
    protectedLimiter,
    publicQuoteSessionLimiter,
    publicApiLimiter,
    publicApiDocsLimiter,
    webhookLimiter,
    readinessPollingLimiter,
  } = deps;

  if (process.env.KERNEL_PLATFORM_MODE === 'true') {
    router.use('/v1/mcp/config', protectedLimiter, createPlatformMcpRouter('config'));
    router.use('/v1/mcp/operator', protectedLimiter, createPlatformMcpRouter('operator'));
    const service = createPlatformTenantService({ prisma,
      publicBaseUrl: process.env.KERNEL_PUBLIC_URL || process.env.KERNEL_PUBLIC_BASE_URL || 'http://localhost:4326',
      fromEmail: process.env.KERNEL_FROM_EMAIL || 'noreply@facio.io',
    });
    router.use('/auth', publicLimiter, (_req, res, next) => {
      if (process.env.KERNEL_PASSWORD_LOGIN_ENABLED !== 'true') return res.status(403).json({ success: false, error: { code: 'ORGANIZATION_SIGN_IN_REQUIRED', message: 'Use organization sign-in.' } });
      return next();
    }, loginRouter);
    router.use('/platform', protectedLimiter, authenticate, createPlatformRouter(service));
    platformTenantAccess = createPlatformTenantAccess((userId, tenantSlug) => service.resolveAccess(userId, tenantSlug));
  }

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
  if (platformTenantAccess) router.use(platformTenantAccess);
  router.use(setAccountScopeContext);
  router.use(createClientApiRouter());
  router.use(createBoApiRouter());

  return router;
}
