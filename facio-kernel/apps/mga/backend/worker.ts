// Dedicated worker process entrypoint.
// Run this in a separate container/service for zero-impact background work.

// Sentry must initialise before any auto-instrumented module is loaded
// (see `./platform/observability/instrument.ts`).
import './platform/observability/instrument.js';
import 'dotenv/config';
import { createServer } from 'node:http';
import { initApplicationInsights, flushTelemetry } from './platform/observability/appInsights.js';
import { captureSentryException, flushSentry, getSentryStatus } from './platform/observability/sentry.js';
import { initWorkers } from './platform/events/queue.js';
import { registerAllProducts } from './products/registerProducts.js';

import { logger } from './platform/utils/logger.js';
const role = process.env.WORKER_ROLE || 'all';
process.env.SERVICE_ROLE = process.env.SERVICE_ROLE || `abbeygate-worker-${role}`;
initApplicationInsights();
const concurrency = process.env.WORKER_CONCURRENCY
    ? Number(process.env.WORKER_CONCURRENCY)
    : 'auto-from-effective-pool';
if (!process.env.QUEUE_WORKERS_ENABLED) {
    process.env.QUEUE_WORKERS_ENABLED = 'true';
}
logger.info({ role, concurrency }, 'Worker starting');

registerAllProducts();
await import('./workers/registerBuiltInHandlers.js');
initWorkers();

const healthPort = Number(process.env.WORKER_HEALTH_PORT || 3001);
const healthServer = createServer((req, res) => {
    if (req.url === '/health') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, role }));
        return;
    }
    if (req.url === '/health/sentry') {
        const sentryStatus = getSentryStatus();
        const isProdEnv = (process.env.NODE_ENV || 'development') === 'production';
        res.statusCode = sentryStatus.initialized || !isProdEnv ? 200 : 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(sentryStatus));
        return;
    }
    res.statusCode = 404;
    res.end('not found');
});

healthServer.listen(healthPort, () => {
    logger.info({ event: 'worker.health.ready', healthPort, role }, 'worker.health.ready');
});

// Keep the process alive; BullMQ/Redis connections should already do this,
// but a tiny interval makes it explicit and avoids some edge cases.
setInterval(() => {}, 60_000);

process.on('SIGTERM', async () => {
    logger.info({ event: 'worker.signal.sigterm' }, 'worker.signal.sigterm');
    healthServer.close();
    await flushTelemetry(2000);
    await flushSentry(2000);
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info({ event: 'worker.signal.sigint' }, 'worker.signal.sigint');
    healthServer.close();
    await flushTelemetry(2000);
    await flushSentry(2000);
    process.exit(0);
});

process.on('unhandledRejection', async (reason) => {
    logger.fatal({ event: 'worker.unhandled_rejection', err: reason }, 'worker.unhandled_rejection');
    captureSentryException(reason);
    await flushTelemetry(2000);
    await flushSentry(2000);
    process.exit(1);
});

process.on('uncaughtException', async (err) => {
    logger.fatal({ event: 'worker.uncaught_exception', err }, 'worker.uncaught_exception');
    captureSentryException(err);
    await flushTelemetry(2000);
    await flushSentry(2000);
    process.exit(1);
});
