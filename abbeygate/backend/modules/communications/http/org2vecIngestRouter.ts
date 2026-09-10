/**
 * org2vecIngestRouter — BO-authenticated Org2Vec email ingestion (ADR-0044).
 *
 * Mounted under `/api/bo/org2vec/ingest`. Demo connector endpoints:
 *   POST /            — ingest from a source (sample | upload | graph)
 *   GET  /sample      — list bundled sample conversations
 *
 * Thin transport: validates the request, delegates to the app layer, never
 * touches the DB or LLM directly.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../../../platform/utils/logger.js';
import { runEmailIngestion, listSampleConversations } from '../app/runEmailIngestion.js';

const router = Router();

const UploadSchema = z.union([
  z.object({ kind: z.literal('json'), messages: z.array(z.unknown()) }),
  z.object({ kind: z.literal('eml'), files: z.array(z.string()) }),
]);

const IngestSchema = z.object({
  source: z.enum(['sample', 'upload', 'graph']),
  filterKey: z.string().optional(),
  // Demo/operator override: link the ingested thread(s) to a specific
  // business object instead of relying on identifier resolution. The
  // target is still verified against canonical Postgres in tenant scope —
  // an unknown id resolves to UNRESOLVED, it is never force-linked.
  target: z
    .object({
      scopeType: z.enum(['CLAIM', 'SUBMISSION']),
      scopeId: z.string().min(1),
    })
    .optional(),
  upload: UploadSchema.optional(),
  graph: z
    .object({
      accessToken: z.string().optional(),
      mailbox: z.string().optional(),
      top: z.number().int().positive().max(50).optional(),
    })
    .optional(),
});

function actorId(req: Request): string {
  return String(req.user?.id || 'bo-user');
}

router.post('/', async (req: Request, res: Response) => {
  const parsed = IngestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_REQUEST', message: parsed.error.issues.map((i) => i.message).join('; ') },
    });
  }
  try {
    const result = await runEmailIngestion({ ...parsed.data, actorId: actorId(req) });
    return res.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ingestion failed';
    logger.error({ err, event: 'org2vec.ingest.failed' }, 'org2vec.ingest.failed');
    return res.status(502).json({ success: false, error: { code: 'INGEST_FAILED', message } });
  }
});

router.get('/sample', async (_req: Request, res: Response) => {
  try {
    const conversations = await listSampleConversations();
    return res.json({ success: true, data: { conversations } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to list samples';
    return res.status(500).json({ success: false, error: { code: 'SAMPLE_LIST_FAILED', message } });
  }
});

export default router;
