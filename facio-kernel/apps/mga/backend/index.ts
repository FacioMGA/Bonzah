// FacioMGA - Express Server Entry Point
// Main application server for Abbeygate 2025 Binder MVP

// Sentry must initialise before express/prisma/applicationinsights are
// loaded so OpenTelemetry instrumentations can patch them (ESM hoists
// every import in this file before any non-import body runs). See
// `./platform/observability/instrument.ts` for the full rationale.
import './platform/observability/instrument.js';
import 'dotenv/config';
process.env.SERVICE_ROLE = process.env.SERVICE_ROLE || 'abbeygate-api';

import { captureSentryException, flushSentry, getSentryStatus, setupSentryExpressErrorHandler } from './platform/observability/sentry.js';

// Initialize Application Insights FIRST (before any other imports)
// This ensures request correlation and dependency tracking work correctly
import { initApplicationInsights } from './platform/observability/appInsights.js';
initApplicationInsights();

import express, { Express, Request, Response, NextFunction } from 'express';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { isStaticAssetPath } from './http/spaFallback.js';
import { isPublicMediaAsset } from './http/crossOriginAssets.js';
import { connectToDatabase, prisma } from './platform/db/connection.js';
import { ensureDbIndexes } from './platform/db/indexBootstrap.js';
import { flushTelemetry } from './platform/observability/appInsights.js';
import { summarizeIntegrationHealth } from './platform/config/integrationHealth.js';

// Route Imports
import { createApiRouter } from './http/composition.js';
import { createPlatformIdentityRouter } from './modules/platformIdentity/index.js';
import { requestLogger, errorLogger } from './http/middleware/logger.js';
import { getCorrelationId } from './platform/observability/context.js';
import { perfTimingMiddleware } from './http/middleware/perfTiming.js';
import { startOutboxRelay } from './platform/events/relay.js';
import { loadRegistryFromDb } from './modules/mbe/app/registryLoader.js';
import { ensureDefaultPrograms } from './modules/programs/app/bootstrap.js';
import { MagicBService } from './modules/mbe/domain/service.js';
import { seedPermissionsAndSystemRoles } from './modules/accessControl/infra/permissionSeeder.js';
import { validateStartupConfig } from './platform/config/startupValidation.js';
import { ensureUploadsDirReady, resolvePolicyDocumentsDir } from './platform/runtime/runtimePaths.js';
import { runNonHttpBootstraps } from './platform/runtime/nonHttpBootstrap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import helmet from 'helmet';
import { applicationContentSecurityPolicy } from './platform/http/contentSecurityPolicy.js';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import {
  getClientIpForRateLimit,
  isPublicQuoteSessionRequest,
  PUBLIC_API_RATE_LIMIT_MAX_DEFAULT,
  readRateLimitInt,
  resolvePublicApiIdentityKey,
  resolvePublicQuoteSessionLimiterKey,
  resolveReadinessLimiterKey,
} from './platform/http/middleware/rateLimit.js';

import { logger } from './platform/utils/logger.js';
import { registerAllProducts } from './products/registerProducts.js';
import { oauthDiscoveryRouter, oauthFlowRouter, registerConfigTools, registerOperatorTools } from './modules/mcp/index.js';

registerAllProducts();
// Config MCP V1 (ADR-0036). One-shot registration of every `config.*`
// tool descriptor into the canonical MCP tool registry. Must run after
// product registration so tools that reference the registered products
// resolve correctly.
registerConfigTools();
// Operator MCP V1 (ADR-0036 amendment #2). Same registry, different
// dotted family. Order does not matter — tool names are globally unique
// within the registry.
registerOperatorTools();

const app: Express = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

type RawBodyRequest = Request & { rawBody?: Buffer };

// Trust proxy (Critical for Azure App Service + Rate Limiting)
// Azure terminates SSL and sends X-Forwarded-* headers.
// Note: express-rate-limit validates `req.ip` strictly as an IP address. Some Azure/proxy setups
// may include a port in X-Forwarded-For values (e.g. "109.186.70.57:63111"), which breaks that
// validation unless we normalize the IP for the rate-limit key.
app.set('trust proxy', 1);


// Security Middleware
app.use(helmet({
  // Helmet's default CSP blocks Google Maps + external widgets. Configure a minimal allowlist.
  // Report violations in development; enforce the same directives in production.
  contentSecurityPolicy: applicationContentSecurityPolicy(IS_PROD),
  strictTransportSecurity: {
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true,
  },
  crossOriginEmbedderPolicy: false,
}));

// Rate Limiting (Public Routes)
const publicLimiter = rateLimit({
  windowMs: readRateLimitInt('RATE_LIMIT_PUBLIC_WINDOW_MS', 15 * 60 * 1000),
  max: readRateLimitInt('RATE_LIMIT_PUBLIC_MAX', IS_PROD ? 100 : 1500),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIpForRateLimit(req),
  skip: (req) => isPublicQuoteSessionRequest(req),
  handler: (_req, res) => {
    // Always return JSON for API clients (prevents "not valid JSON" crashes in the SPA)
    res.status(429).json({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests. Please retry shortly.',
      },
    });
  },
});
app.use('/api/public', publicLimiter);
app.use('/api/auth', publicLimiter);

const publicQuoteSessionLimiter = rateLimit({
  windowMs: readRateLimitInt('RATE_LIMIT_PUBLIC_SESSION_WINDOW_MS', 15 * 60 * 1000),
  max: readRateLimitInt('RATE_LIMIT_PUBLIC_SESSION_MAX', IS_PROD ? 1200 : 2500),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolvePublicQuoteSessionLimiterKey(req),
});

const publicApiLimiter = rateLimit({
  windowMs: readRateLimitInt('RATE_LIMIT_V1_WINDOW_MS', 60 * 1000),
  max: readRateLimitInt('RATE_LIMIT_V1_MAX', PUBLIC_API_RATE_LIMIT_MAX_DEFAULT),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolvePublicApiIdentityKey(req),
});
const publicApiDocsLimiter = rateLimit({
  windowMs: readRateLimitInt('RATE_LIMIT_V1_DOCS_WINDOW_MS', 60 * 1000),
  max: readRateLimitInt('RATE_LIMIT_V1_DOCS_MAX', 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `docs:${getClientIpForRateLimit(req)}`,
});
const webhookLimiter = rateLimit({
  windowMs: readRateLimitInt('RATE_LIMIT_WEBHOOK_WINDOW_MS', 60 * 1000),
  max: readRateLimitInt('RATE_LIMIT_WEBHOOK_MAX', 1200),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `webhook:${getClientIpForRateLimit(req)}`,
});
const readinessPollingLimiter = rateLimit({
  windowMs: readRateLimitInt('RATE_LIMIT_READINESS_WINDOW_MS', 60 * 1000),
  max: readRateLimitInt('RATE_LIMIT_READINESS_MAX', 90),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => resolveReadinessLimiterKey(req),
});

// Middleware
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    const target = req as RawBodyRequest;
    if (String(target.originalUrl || '').includes('/webhooks/sendgrid/events')) {
      target.rawBody = Buffer.from(buf);
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// CardCorp webhooks may use `text/plain` bodies (encrypted hex string). Parse as text for this route only.
app.use('/api/public/payments/cardcorp/webhook', express.text({ type: 'text/plain', limit: '2mb' }));

// Reduce payload size over WAN (Azure) for large JSON responses.
app.use(compression());

// Performance timing + request id (Server-Timing)
app.use(perfTimingMiddleware);

// Comprehensive Request Logging
app.use(requestLogger);

// CORS configuration
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  const isDev = (process.env.NODE_ENV || 'development') === 'development';

  const allowedOrigins = [
    ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()),
    process.env.CORS_ORIGIN,
    process.env.KERNEL_PUBLIC_BASE_URL,
  ].filter(Boolean) as string[];

  const allowOrigin = origin && (allowedOrigins.includes(origin) || (isDev && process.env.KERNEL_PLATFORM_MODE !== 'true'));
  if (origin && allowOrigin) {
    // In dev, echo the requesting origin so browsers accept it (also works with credentials).
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Idempotency-Key, X-Correlation-Id, X-Request-Id, X-Facio-Surface, X-Tenant-Id, X-Tenant-Slug, traceparent, tracestate');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  return next();
});

// OAuth 2.1 discovery + flow endpoints (ADR-0040 — MCP V2.1).
// Mounted at ROOT (NOT under /api) per RFC 9728 §3.1 + OpenAI Apps SDK
// — ChatGPT reads `https://<tenant>/.well-known/...` and `/oauth/*`.
//
// CRITICAL — mount under explicit path prefixes (NOT
// `app.use(oauthRouter)` without a path). The unprefixed form makes
// Express delegate EVERY request into the router. Each OAuth router
// applies `resolveOperatingTenant` as its first middleware (needed
// for `getTenantConfig().publicBaseUrl` inside metadata builders).
// Without a path prefix, even a `/health` request enters the router,
// runs `resolveOperatingTenant`, gets 403 TENANT_UNRESOLVED (the K8s
// probe sends no tenant header), and the pod never becomes Ready →
// Helm 3-minute timeout rollback. Two deploy timeouts on 2026-05-28
// (18:24 + 18:49 UTC) confirmed this is the failure mode.
//
// Path-prefix mounting scopes the entire router (including its
// resolveOperatingTenant) to requests under that prefix only.
if (process.env.KERNEL_PLATFORM_MODE === 'true') app.use(createPlatformIdentityRouter(prisma));
app.use('/.well-known', oauthDiscoveryRouter);
app.use('/oauth', oauthFlowRouter);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'FacioMGA API',
    version: '1.0.5',
    build: process.env.BUILD_SHA || 'local-development',
    deployment: process.env.KERNEL_PLATFORM_MODE === 'true' ? 'shared-mga-platform' : 'standalone',
    observability: process.env.KERNEL_OBSERVABILITY_MODE === 'structured_logs' ? 'structured_logs' : 'sentry'
  });
});

// Database health check
app.get('/health/db', async (_req: Request, res: Response) => {
  try {
    // Determine DB health by running a simple query
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    return res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: 'Database unavailable',
    });
  }
});

// Provider integration health (CardCorp, Creditsafe, …).
// Distinct from /health (liveness): this endpoint is meant for deploy smoke
// checks and ops dashboards. Returns 503 in production when a required
// integration is unconfigured so a missing K8s secret key fails the deploy
// instead of silently returning 501 at the first checkout.
app.get('/health/integrations', (_req: Request, res: Response) => {
  const summary = summarizeIntegrationHealth();
  const isProdEnv = (process.env.NODE_ENV || 'development') === 'production';
  const httpStatus = summary.status === 'ok' || !isProdEnv ? 200 : 503;
  return res.status(httpStatus).json(summary);
});

// Sentry boot status (debug). The deploy gate is `/health/integrations`;
// this endpoint is for humans verifying the SDK actually wired up and
// the DSN host the pod is shipping events to. No secrets are returned.
app.get('/health/sentry', (_req: Request, res: Response) => {
  const sentryStatus = getSentryStatus();
  const isProdEnv = (process.env.NODE_ENV || 'development') === 'production';
  const httpStatus = sentryStatus.initialized || !isProdEnv ? 200 : 503;
  return res.status(httpStatus).json(sentryStatus);
});

// Sentry pipe smoke test (debug). Gated by SENTRY_SMOKE_TOKEN so anyone
// with the token can prove the wiring end-to-end in 60s. Without the env
// var, the endpoint returns 404 (looks like a regular route mismatch).
// Three variants stress the three paths Sentry can receive events on:
//   - `?type=express` throws synchronously, exercises express error middleware
//     + `setupSentryExpressErrorHandler` → captures via auto-handler.
//   - `?type=manual` calls `captureSentryException` directly → tests helper.
//   - `?type=background` calls `captureBackgroundException` directly → tests
//     the rate-limited helper used by BullMQ/Redis paths.
// The token is supplied via the `X-Sentry-Smoke-Token` header. Returning
// the event-id lets the caller verify the event landed in Sentry by
// searching `event.id:<id>` in the abbeygate project.
app.post('/api/__debug/sentry-smoke', (req: Request, res: Response, next: NextFunction) => {
  const configured = String(process.env.SENTRY_SMOKE_TOKEN || '').trim();
  if (!configured) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  }
  const provided = String(req.header('x-sentry-smoke-token') || '').trim();
  if (provided !== configured) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
  }
  const type = String(req.query.type || 'manual');
  const marker = `sentry-smoke-${Date.now()}`;

  if (type === 'express') {
    return next(new Error(`Sentry smoke (express path): ${marker}`));
  }

  if (type === 'background') {
    void import('./platform/observability/sentry.js').then(({ captureBackgroundException }) => {
      captureBackgroundException(new Error(`Sentry smoke (background path): ${marker}`), {
        tag: 'sentry_smoke.background',
        extra: { marker },
      });
    });
    return res.status(202).json({ ok: true, marker, type, note: 'sent via captureBackgroundException (rate-limited)' });
  }

  captureSentryException(new Error(`Sentry smoke (manual path): ${marker}`));
  return res.status(202).json({ ok: true, marker, type: 'manual' });
});

// Rate limiting for protected routes (defense-in-depth vs brute force / API scraping).
const protectedLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 600, // per IP per minute (tune based on real traffic)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIpForRateLimit(req),
});

// SPA shell + asset-404 fallback (the catch-all `app.get('*')` below).
// Both branches do filesystem work — `res.sendFile(index.html)` for the
// SPA navigation case, and a 404 response for asset-shaped paths
// (matched by `isStaticAssetPath`). A real browser session generates
// at most a handful of hits per page navigation, so the budget is
// generous; the limiter is here to short-circuit a `wget --recursive`
// or similar enumeration loop. Closes the CodeQL `js/missing-rate-limiting`
// alert on the catch-all that pre-existed at `backend/index.ts:427`
// before ABBEYGATE-REACT-3.
const frontendLimiter = rateLimit({
  windowMs: readRateLimitInt('RATE_LIMIT_FRONTEND_WINDOW_MS', 60 * 1000),
  max: readRateLimitInt('RATE_LIMIT_FRONTEND_MAX', 600),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIpForRateLimit(req),
});
app.use(
  '/api',
  createApiRouter({
    publicLimiter,
    protectedLimiter,
    publicQuoteSessionLimiter,
    publicApiLimiter,
    publicApiDocsLimiter,
    webhookLimiter,
    readinessPollingLimiter,
  }),
);



// Error handling middleware
setupSentryExpressErrorHandler(app);
app.use(errorLogger);
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({
    event: 'http.unhandled_error',
    method: req.method,
    path: req.path,
    err,
  }, 'http.unhandled_error');

  const cid = getCorrelationId();
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An internal server error occurred'
        : err.message,
      ...(cid ? { correlationId: cid } : {}),
    },
  });
});

// Serve uploads in development AND production for this VM setup
// SECURITY FIX: Disable public static access to uploads
// const uploadsPath = join(process.cwd(), 'uploads');
// app.use('/uploads', express.static(uploadsPath));

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  const frontendPath = join(__dirname, '../../dist');
  app.use(express.static(frontendPath, {
    setHeaders: (res, filePath) => {
      const p = String(filePath || '');
      // Public branding media (logos, images, fonts) must be loadable from a
      // cross-origin context. The global Helmet default is
      // `Cross-Origin-Resource-Policy: same-origin`, which makes external
      // renderers (e.g. the Marker.io bug-capture DOM snapshot) show broken
      // images instead of the real logos. These files are public and
      // non-sensitive; application code (JS/CSS) keeps the same-origin posture.
      // (ABY-358 — `isPublicMediaAsset` is the single source of truth.)
      if (isPublicMediaAsset(p)) {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      }
      // HTML app shell: always revalidate (avoid serving stale shells after deploy).
      if (p.endsWith('.html')) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        return;
      }
      // Fingerprinted static assets: cache aggressively.
      if (p.includes('/assets/') || p.match(/\.[a-f0-9]{8,}\.(js|css|png|jpg|jpeg|webp|svg|woff2?)$/i)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      // Default: short cache, safe for misc files.
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }));
  // ABBEYGATE-REACT-3 — SPA fallback must NOT serve `index.html` for
  // requests that look like fingerprinted asset URLs (e.g.
  // `/assets/index-Ceif57sg.js` from a previous release that no longer
  // exists on disk). When the asset is gone, falling through to the
  // catch-all would return the SPA shell with `Content-Type: text/html`,
  // and modern browsers' strict ESM loader rejects that with
  // `TypeError: 'text/html' is not a valid JavaScript MIME type`.
  // Surfaced on iOS Safari 18.7 clients holding a stale tab open
  // across a deploy and following an internal Suspense import to a
  // now-removed chunk hash. `isStaticAssetPath` (imported above from
  // `./http/spaFallback`) is the single source of truth for "this
  // looks like a fingerprinted static asset; if the static middleware
  // could not serve it, 404 explicitly so the frontend's lazy-import
  // error boundary can surface the failure instead of trying to eval
  // HTML."
  app.get('*', frontendLimiter, (req: Request, res: Response) => {
    if (isStaticAssetPath(req.path || '')) {
      // Static body — never echo `req.path` into the response (CodeQL
      // `js/reflected-xss`). The browser already has the URL it asked
      // for; the 404 status is the operational signal.
      res.status(404).type('text/plain').send('Asset not found');
      return;
    }
    res.sendFile(join(frontendPath, 'index.html'));
  });
} else {
  const resolveDevPublicAppBaseUrl = () => {
    const configured = String(
      process.env.PUBLIC_APP_BASE_URL ||
      process.env.FRONTEND_URL ||
      process.env.APP_URL ||
      ''
    ).trim();
    if (configured) return configured.replace(/\/$/, '');
    return 'http://localhost:5173';
  };

  app.get(['/quote', '/quote/*', '/get-auto-quote', '/questionnaire/*', '/fnol/*', '/verify-email'], (req: Request, res: Response) => {
    const base = resolveDevPublicAppBaseUrl();
    const target = `${base}${req.originalUrl || req.url || ''}`;
    return res.redirect(302, target);
  });

  // 404 handler for development
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`,
      },
    });
  });
}

// Connect to database and start server
export async function startApiServerProcess() {
  try {
    // Security Configuration Check — JWT_SECRET is mandatory in every
    // environment. The startup-validator (backend/platform/config/startupValidation.ts)
    // also rejects the previous 'dev-jwt-secret-change-me' value to prevent
    // a misclassified env from running with a placeholder. Local dev MUST
    // provide a value via .env / .env.example.
    if (!process.env.JWT_SECRET) {
      logger.error('❌ FATAL: JWT_SECRET is not defined. Server cannot start. Set JWT_SECRET in your .env (see .env.example).');
      process.exit(1);
    }

    if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
      logger.warn('⚠️  WARNING: CORS_ORIGIN is not defined in production. API may be accessible from unexpected origins.');
    }

    const storageProvider = String(process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase();
    if (storageProvider === 'local') {
      // Fail-fast only when local filesystem uploads are the active storage mode.
      const uploadsDir = ensureUploadsDirReady();
      logger.info({ uploadsDir }, '✅ Runtime uploads directory ready');
    } else {
      logger.info({ storageProvider }, 'ℹ️ Runtime uploads directory readiness skipped for non-local storage');
    }
    logger.info({ policyDocumentsDir: resolvePolicyDocumentsDir() }, 'ℹ️ Operator policy documents directory resolved');

    // Connect to Postgres (fail-fast: the API isn't usable without DB)
    await connectToDatabase();
    await prisma.$queryRaw`SELECT 1`;
    logger.info('✅ Connected to Database');

    // Validate critical runtime config (doc generation templates etc.)
    await validateStartupConfig();

    // Start HTTP server ASAP so health probes pass while Redis/queue bootstrap continues.
    const server = app.listen(PORT, () => {
      logger.info(`🚀 FacioMGA API server running on port ${PORT}`);
      logger.info(`📊 Health check: http://localhost:${PORT}/health`);
      logger.info(`🗄️  Database check: http://localhost:${PORT}/health/db`);
    });
    server.timeout = 300000;

    // Boot optional subsystems in the background (do not block readiness / listening).
    // Redis/BullMQ are loaded lazily here so that the module-scope side effects
    // (ioredis Cluster connection, Queue construction) do not block or crash the
    // process before the health port is bound.
    void runNonHttpBootstraps({
      ensureDbIndexes: () => ensureDbIndexes(),
      startEventSystem: async () => {
        const queueModule = await import('./platform/events/queue.js');
        const redisClientModule = await import('./platform/redis/client.js');
        // Start both independently-owned Redis clients together.  The
        // general-purpose client protects inbound webhook replay and is not a
        // queue implementation detail, so waiting for BullMQ first leaves a
        // rollout window in which the first request can fall back to pod-local
        // memory before it has even begun its TLS connection.
        const queueReady = queueModule.ensureQueueRedisReady()
          .then(() => logger.info('✅ Connected to Redis'))
          .catch((err: unknown) => logger.error({ err }, 'Redis readiness failed (queues may be degraded)'));
        const clientReady = redisClientModule.ensureRedisClientReady()
          .then(() => logger.info('✅ Redis client ready'))
          .catch((err: unknown) => logger.error({ err }, 'Redis client readiness failed (replay guard may use memory fallback)'));
        await Promise.all([queueReady, clientReady]);
        const workersEnabledRaw = String(process.env.QUEUE_WORKERS_ENABLED || '').trim().toLowerCase();
        const workersEnabled =
          workersEnabledRaw === 'true'
            ? true
            : workersEnabledRaw === 'false'
              ? false
              : !IS_PROD;
        if (workersEnabled) {
          logger.info('🧵 Queue workers enabled for this process (QUEUE_WORKERS_ENABLED=true).');
          queueModule.initWorkers();
        } else {
          logger.info('⏭️  Queue workers disabled for this process (QUEUE_WORKERS_ENABLED=false).');
        }
        startOutboxRelay();
      },
      ensureDefaultProgram: async () => {
        if (process.env.KERNEL_PLATFORM_MODE === 'true') return;
        await ensureDefaultPrograms();
      },
      loadMbeRegistry: () => loadRegistryFromDb(),
      ensureMbeTemplatesSeeded: () => MagicBService.ensureAllTemplatesSeeded(),
      seedAccessControlPermissions: () => seedPermissionsAndSystemRoles(),
      initPdfWorker: async () => {
        const { pdfWorker } = await import('./platform/runtime/jobs/pdfWorker.js');
        void pdfWorker;
      },
    });
  } catch (error) {
    captureSentryException(error);
    await flushSentry(2000);
    logger.error({ err: error }, 'Failed to start server:');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info({ event: 'process.signal.sigterm' }, 'process.signal.sigterm');
  await prisma.$disconnect();
  await flushTelemetry(2000);
  await flushSentry(2000);
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info({ event: 'process.signal.sigint' }, 'process.signal.sigint');
  await prisma.$disconnect();
  await flushTelemetry(2000);
  await flushSentry(2000);
  process.exit(0);
});

process.on('unhandledRejection', async (reason) => {
  logger.fatal({ event: 'process.unhandled_rejection', err: reason }, 'process.unhandled_rejection');
  captureSentryException(reason);
  await flushTelemetry(2000);
  await flushSentry(2000);
  process.exit(1);
});

process.on('uncaughtException', async (err) => {
  logger.fatal({ event: 'process.uncaught_exception', err }, 'process.uncaught_exception');
  captureSentryException(err);
  await flushTelemetry(2000);
  await flushSentry(2000);
  process.exit(1);
});

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  // Compatibility-only: canonical runtime entrypoint is apps/api/index.ts.
  void startApiServerProcess();
}

export default app;
