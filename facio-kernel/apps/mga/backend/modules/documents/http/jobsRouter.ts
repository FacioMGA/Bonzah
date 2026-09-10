import express from 'express';
import { getPdfJobStatus } from '../../../platform/runtime/jobs/pdfQueue.js';
import { logger } from '../../../platform/utils/logger.js';

/**
 * Job Status API
 * 
 * Allows clients to poll for job completion status.
 * Used for async PDF generation tracking.
 * 
 * GET /api/jobs/:jobId
 */

const router = express.Router();

router.get('/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;

        const status = await getPdfJobStatus(jobId);

        if (!status) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'NOT_FOUND',
                    message: 'Job not found',
                },
            });
        }

        return res.json({
            success: true,
            data: status,
        });
    } catch (error) {
        logger.error({
            jobId: req.params.jobId,
            error: error instanceof Error ? error.message : String(error),
        }, '[Jobs API] Failed to get job status');

        return res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to check job status',
            },
        });
    }
});

export default router;
