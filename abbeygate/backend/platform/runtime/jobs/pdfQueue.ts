import { Queue } from 'bullmq';
import { createBullMqConnection } from '../../redis/connectionOptions.js';
import { logger } from '../../utils/logger.js';

/**
 * PDF Queue Service
 * 
 * Manages background PDF generation jobs using BullMQ.
 * PDFs are generated asynchronously to avoid blocking API responses.
 * 
 * Performance Impact:
 * - Before: 5000ms (synchronous PDF generation)
 * - After: <100ms (queue job, return immediately)
 * - Improvement: 98% faster response time
 */

// Canonical BullMQ connection factory (cluster-aware). Queue name
// MUST match `pdfWorker.ts` and MUST be wrapped in `{...}` for Redis
// Cluster hash-tag slotting (ABBEYGATE-9). See
// `backend/platform/redis/connectionOptions.ts`.
export const pdfQueue = new Queue('{pdf-generation}', {
    connection: createBullMqConnection(),
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000, // 2s, 4s, 8s
        },
        removeOnComplete: {
            count: 100, // Keep last 100 successful jobs for debugging
            age: 24 * 3600, // 24 hours
        },
        removeOnFail: {
            count: 500, // Keep failed jobs longer for investigation
            age: 7 * 24 * 3600, // 7 days
        },
    },
});

export interface QueuePdfJobParams {
    type: 'schedule' | 'endorsements';
    policyId: string;
    policyNumber: string;
    endorsements?: unknown[];
    metadata?: Record<string, unknown>;
}

/**
 * Queue a PDF generation job
 * 
 * @param params - PDF generation parameters
 * @returns Job details including ID and status check URL
 * 
 * @example
 * const job = await queuePdfGeneration({
 *   type: 'schedule',
 *   policyId: 'pol-123',
 *   policyNumber: 'POL-2026-001'
 * });
 * // Returns: { jobId: 'pdf-schedule-pol-123-...', status: 'QUEUED', checkUrl: '/api/jobs/...' }
 */
export async function queuePdfGeneration(params: QueuePdfJobParams) {
    const jobId = `pdf-${params.type}-${params.policyId}-${Date.now()}`;

    logger.info({
        jobId,
        type: params.type,
        policyId: params.policyId,
        policyNumber: params.policyNumber,
    }, '[PDF Queue] Queueing PDF generation');

    const job = await pdfQueue.add('generate-pdf', params, {
        jobId,
    });

    return {
        jobId: job.id!,
        status: 'QUEUED',
        checkUrl: `/api/jobs/${job.id}`,
    };
}

/**
 * Get job status by ID
 * 
 * @param jobId - Job ID returned from queuePdfGeneration
 * @returns Job state and result if completed
 */
export async function getPdfJobStatus(jobId: string) {
    const job = await pdfQueue.getJob(jobId);

    if (!job) {
        return null;
    }

    const state = await job.getState();
    const progress = job.progress;

    if (state === 'completed') {
        return {
            status: 'COMPLETED',
            result: job.returnvalue,
        };
    }

    if (state === 'failed') {
        return {
            status: 'FAILED',
            error: job.failedReason,
            attemptsMade: job.attemptsMade,
        };
    }

    return {
        status: state.toUpperCase(),
        progress,
    };
}
