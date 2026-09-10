/**
 * submissionMemoryRouter — BO Org2Vec submission-memory surface (ADR-0044).
 *
 * Mounted under `/api/bo/policies`:
 *   GET  /:id/submission-memory          — read the projection
 *   POST /:id/submission-memory/refresh  — enqueue a scoped refresh
 *   POST /:id/submission-memory/ask      — retrieval-grounded, read-only Q&A
 *
 * Thin transport; delegates to the policy app layer + the org2vec engine.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma, tenantScopedPrisma } from '../../../platform/db/connection.js';
import { logger } from '../../../platform/utils/logger.js';
import { getSubmissionMemory } from '../app/submissionMemory/getSubmissionMemory.js';
import { enqueueSubmissionMemoryRefresh } from '../app/submissionMemory/enqueueSubmissionMemoryRefresh.js';
import { answerWithCitations } from '../../org2vec/index.js';

const router = Router();

function actorId(req: Request): string {
  return String(req.user?.id || 'bo-user');
}

router.get('/:id/submission-memory', async (req: Request, res: Response) => {
  try {
    const memory = await getSubmissionMemory({ submissionId: String(req.params.id) });
    if (memory.status === 'absent') {
      return res.json({
        success: true,
        data: { submissionId: memory.submissionId, status: 'absent', projection: null, stalenessWarning: false },
      });
    }
    const p = memory.projection!;
    return res.json({
      success: true,
      data: {
        submissionId: memory.submissionId,
        status: 'present',
        stalenessWarning: memory.stalenessWarning,
        projection: {
          summary: p.summary,
          summaryCitations: p.summaryCitations,
          memoryObject: p.memoryObject,
          similarSubmissions: p.similarSubmissions,
          refreshStatus: p.refreshStatus,
          refreshError: p.refreshError,
          lastRefreshedAt: p.lastRefreshedAt,
          updatedAt: p.updatedAt,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SUBMISSION_MEMORY_READ_FAILED', message: error instanceof Error ? error.message : 'Failed to load submission memory' },
    });
  }
});

router.post('/:id/submission-memory/refresh', async (req: Request, res: Response) => {
  try {
    const submissionId = String(req.params.id);
    const exists = await tenantScopedPrisma.policy.findUnique({ where: { id: submissionId }, select: { id: true } });
    if (!exists) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } });
    }
    await enqueueSubmissionMemoryRefresh(prisma, {
      submissionId,
      reason: 'bo_route',
      actorId: actorId(req),
      actorType: 'USER',
    });
    return res.json({ success: true, data: { submissionId, enqueued: true } });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'SUBMISSION_MEMORY_REFRESH_FAILED', message: error instanceof Error ? error.message : 'Failed to enqueue refresh' },
    });
  }
});

const AskSchema = z.object({ question: z.string().trim().min(2).max(500) });

router.post('/:id/submission-memory/ask', async (req: Request, res: Response) => {
  const parsed = AskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: 'question is required' } });
  }
  try {
    const result = await answerWithCitations({
      scopeType: 'SUBMISSION',
      scopeId: String(req.params.id),
      question: parsed.data.question,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    logger.error({ err: error, event: 'submission_memory.ask_failed' }, 'submission_memory.ask_failed');
    return res.status(500).json({ success: false, error: { code: 'ASK_FAILED', message: error instanceof Error ? error.message : 'Ask failed' } });
  }
});

export default router;
