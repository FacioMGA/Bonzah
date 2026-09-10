import { Router } from 'express';
import { z } from 'zod';

import { typedHandler, type BoundaryResponse } from '../../../platform/http/typedHandler.js';
import {
  MotorMarketIntegrationError,
  motorMarketSubmissionService,
} from '../app/submissionService.js';

const router = Router();

const ProviderSchema = z.enum(['SEGURNET', 'FIVA']);
const ChannelSchema = z.enum(['SEGURNET_FNM', 'E_SEGURNET', 'IDS_CIDS', 'FIVA']);
const StatusSchema = z.enum([
  'DRAFT',
  'QUEUED',
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'RETRYABLE_FAILURE',
  'TERMINAL_FAILURE',
  'BLOCKED_WAITING_FOR_EXTERNAL_SPEC',
]);

const ListQuerySchema = z.object({
  provider: ProviderSchema.optional(),
  channel: ChannelSchema.optional(),
  status: StatusSchema.optional(),
  limit: z.string().trim().optional(),
}).strict();

const IdParamsSchema = z.object({ id: z.string().trim().min(1) }).strict();
const PolicyParamsSchema = z.object({ policyId: z.string().trim().min(1) }).strict();
const ClaimParamsSchema = z.object({ claimId: z.string().trim().min(1) }).strict();
const PolicyBodySchema = z.object({ riskTransactionId: z.string().trim().min(1).optional() }).strict().default({});

function actor(req: { user?: Express.UserTokenPayload }) {
  return {
    actorId: req.user?.id ? String(req.user.id) : null,
    actorName: req.user?.name ? String(req.user.name) : (req.user?.email ? String(req.user.email) : null),
  };
}

function sendMotorMarketError(res: BoundaryResponse, error: unknown): void {
  if (error instanceof MotorMarketIntegrationError) {
    res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  throw error;
}

router.get('/checklist', typedHandler({}, async (_req, res) => {
  res.json({ success: true, data: motorMarketSubmissionService.checklist() });
}));

router.get('/submissions', typedHandler({ query: ListQuerySchema }, async (req, res) => {
  const items = await motorMarketSubmissionService.listSubmissions({
    provider: req.query.provider,
    channel: req.query.channel,
    status: req.query.status,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  res.json({ success: true, data: { items } });
}));

router.get('/reconciliation', typedHandler({}, async (_req, res) => {
  const data = await motorMarketSubmissionService.reconciliation();
  res.json({ success: true, data });
}));

router.post(
  '/policies/:policyId/segurnet-fnm',
  typedHandler({ params: PolicyParamsSchema, body: PolicyBodySchema }, async (req, res) => {
    try {
      const { body } = req;
      const data = await motorMarketSubmissionService.preparePolicySubmission({
        policyId: req.params.policyId,
        riskTransactionId: body.riskTransactionId || null,
        ...actor(req),
      });
      res.json({ success: true, data });
    } catch (error) {
      sendMotorMarketError(res, error);
    }
  }),
);

router.post(
  '/claims/:claimId/e-segurnet-fnol',
  typedHandler({ params: ClaimParamsSchema }, async (req, res) => {
    try {
      const data = await motorMarketSubmissionService.prepareClaimSubmission({
        claimId: req.params.claimId,
        channel: 'E_SEGURNET',
        ...actor(req),
      });
      res.json({ success: true, data });
    } catch (error) {
      sendMotorMarketError(res, error);
    }
  }),
);

router.post(
  '/claims/:claimId/ids-cids',
  typedHandler({ params: ClaimParamsSchema }, async (req, res) => {
    try {
      const data = await motorMarketSubmissionService.prepareClaimSubmission({
        claimId: req.params.claimId,
        channel: 'IDS_CIDS',
        ...actor(req),
      });
      res.json({ success: true, data });
    } catch (error) {
      sendMotorMarketError(res, error);
    }
  }),
);

router.post('/submissions/:id/retry', typedHandler({ params: IdParamsSchema }, async (req, res) => {
  try {
    const data = await motorMarketSubmissionService.retrySubmission(req.params.id, actor(req));
    res.json({ success: true, data });
  } catch (error) {
    sendMotorMarketError(res, error);
  }
}));

export default router;
