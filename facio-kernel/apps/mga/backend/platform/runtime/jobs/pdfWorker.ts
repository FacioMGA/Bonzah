import { Worker, type Job } from 'bullmq';
import { tenantScopedPrisma } from '../../db/connection.js';
import { captureBackgroundException } from '../../observability/sentry.js';
import { createBullMqConnection } from '../../redis/connectionOptions.js';
import { logger } from '../../utils/logger.js';
import { invokeTenantJob } from '../../events/platformJobContext.js';

type PdfRendererModule = typeof import('../../../modules/documents/domain/renderers/pdfRenderer.js');
const pdfRendererModule: PdfRendererModule = await import('../../../modules/documents/domain/renderers/pdfRenderer.js');

/**
 * PDF Worker
 * 
 * Background worker that processes PDF generation jobs.
 * Uses Puppeteer to render HTML to PDF (blocking operation).
 * 
 * Concurrency: Limited to 2 to avoid overwhelming server with Puppeteer instances
 */

interface PdfJobData {
    type: 'schedule' | 'endorsements';
    policyId: string;
    policyNumber: string;
    endorsements?: unknown[];
    metadata?: Record<string, unknown>;
}

// Canonical BullMQ connection factory — returns IORedisCluster when
// `REDIS_ENABLE_CLUSTER=true`, IORedis otherwise. Before this factory
// existed (2026-05-17), pdfWorker created its own standalone IORedis
// from options, which silently sent EVALSHA to a non-local slot in
// the production Azure Redis Cluster and got hammered with `MOVED`
// redirects the standalone client cannot follow. See
// `backend/platform/redis/connectionOptions.ts`.
const pdfWorkerConnection = createBullMqConnection();

// Queue name MUST be wrapped in `{...}` for Redis Cluster compatibility
// (Azure Cache for Redis Premium SKU is clustered). The braces are
// ioredis/Cluster hash-tags: they force every key BullMQ derives for
// this queue (`bull:{pdf-generation}:wait`, `:stalled`, `:active`, ...)
// to hash to the same Cluster slot, which the multi-key EVALSHA
// scripts BullMQ uses internally require. Without the braces, you get
// `CROSSSLOT Keys in request don't hash to the same slot` (ABBEYGATE-9).
// The three queues in `events/queue.ts` already follow this convention.
export const pdfWorker = new Worker<PdfJobData>(
    '{pdf-generation}',
    async (job: Job<PdfJobData>) => invokeTenantJob(job, async () => {
        const { type, policyId, policyNumber, endorsements } = job.data;

        logger.info({
            jobId: job.id,
            type,
            policyId,
            policyNumber,
        }, '[PDF Worker] Starting PDF generation');

        try {
            let metadata;

            if (type === 'schedule') {
                // Generate policy schedule PDF
                const policy = await tenantScopedPrisma.policy.findUnique({
                    where: { id: policyId },
                    include: {
                        policyHolder: true,
                    },
                });

                if (!policy) {
                    throw new Error(`Policy not found: ${policyId}`);
                }

                metadata = await pdfRendererModule.PdfRenderer.renderSchedule({
                    policyNumber,
                    policyHolder: {
                        name: policy.policyHolder?.name || 'Unknown',
                    },
                    premium: {
                        total: typeof policy.quoteResponse === 'object' &&
                            policy.quoteResponse !== null &&
                            'premium' in policy.quoteResponse
                            ? (policy.quoteResponse as { premium?: number }).premium || 0
                            : 0,
                    },
                    coverages: [],
                    endorsements: [],
                });
            } else if (type === 'endorsements' && endorsements) {
                // Generate endorsements PDF
                metadata = await pdfRendererModule.PdfRenderer.renderEndorsements({
                    policyNumber,
                    endorsements: endorsements as Array<{
                        code: string;
                        title?: string;
                        status?: string;
                        params?: Record<string, unknown>;
                        legalText?: string;
                        documentRef?: string;
                    }>,
                });
            } else {
                throw new Error(`Unsupported PDF generation type: ${String(type || '')}`);
            }

            logger.info({
                jobId: job.id,
                policyId,
                filename: metadata?.name,
                sizeBytes: metadata?.sizeBytes,
            }, '[PDF Worker] PDF generated successfully');

            return metadata;
        } catch (error) {
            logger.error({
                jobId: job.id,
                policyId,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            }, '[PDF Worker] PDF generation failed');

            throw error;
        }
    }),
    {
        connection: pdfWorkerConnection,
        concurrency: 2, // Max 2 concurrent Puppeteer instances
        lockDuration: 30000, // 30 seconds - enough time for PDF generation
    }
);

// Event handlers for monitoring
pdfWorker.on('completed', (job: Job<PdfJobData>) => {
    logger.info({
        jobId: job.id,
        duration: job.finishedOn ? job.finishedOn - (job.processedOn || job.finishedOn) : undefined,
    }, '[PDF Worker] Job completed');
});

pdfWorker.on('failed', (job, err) => {
    logger.error({
        jobId: job?.id,
        error: err.message,
        attemptsMade: job?.attemptsMade,
    }, '[PDF Worker] Job failed');
    captureBackgroundException(err, {
        tag: 'pdf_worker.job.failed',
        extra: {
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
            policyId: (job?.data as { policyId?: string } | undefined)?.policyId,
            type: (job?.data as { type?: string } | undefined)?.type,
        },
    });
});

pdfWorker.on('error', (err) => {
    logger.error({ error: err.message }, '[PDF Worker] Worker error');
    captureBackgroundException(err, { tag: 'pdf_worker.worker.error' });
});
