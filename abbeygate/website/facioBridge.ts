import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';

const channel = z.enum(['DIRECT', 'DISTRIBUTION']);
const keySchema = z
  .string()
  .min(8)
  .max(90)
  .regex(/^[a-zA-Z0-9._:-]+$/);
const object = z.record(z.string(), z.unknown());
const quoteBody = z.object({ channel, quoteData: object }).strict();
const opaqueReceipt = z.string().min(40).max(24000);
const bindBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('review'), receipt: opaqueReceipt }).strict(),
  z
    .object({ action: z.literal('complete'), receipt: opaqueReceipt, confirmed: z.literal(true) })
    .strict(),
  z.object({ action: z.literal('status'), receipt: opaqueReceipt }).strict(),
  z
    .object({
      action: z.literal('document'),
      receipt: opaqueReceipt,
      documentId: z.string().uuid(),
    })
    .strict(),
]);
const reviewSchema = z.object({
  policyId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  definition: z.object({ id: z.string().uuid(), version: z.number(), hash: z.string().min(1) }),
  currentHash: z.string().min(1),
  riskHash: z.string().min(1),
  premium: z.number().positive(),
  currency: z.string(),
  offerId: z.string().uuid(),
  quoteVersionId: z.string().uuid(),
  expectedVersionHash: z.string().min(1),
  acceptanceKind: z.literal('STAFF_RECORDED'),
  acceptanceSource: z.literal('WEBSITE_REPORTED'),
  paymentMode: z.literal('SIMULATED'),
});
const receiptSchema = z
  .object({
    quoteId: z.string().uuid(),
    quoteToken: z.string().min(20),
    channel,
    premium: z.number().positive(),
    currency: z.string(),
    expiresAt: z.number(),
    review: reviewSchema.optional(),
    policyAccess: z.literal(true).optional(),
  })
  .strict();
type Receipt = z.infer<typeof receiptSchema>;
type Config = {
  baseUrl: string;
  workspaceId: string;
  programId: string;
  binderId: string;
  apiKey: string;
  receiptKey: Buffer;
};
type Options = { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; now?: () => number };

class BridgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: unknown,
  ) {
    super(message);
  }
}
function configuration(env: NodeJS.ProcessEnv, access: 'quote' | 'policy' = 'quote'): Config {
  const apiKey = access === 'quote' ? env.FACIO_QUOTE_API_KEY : env.FACIO_POLICY_API_KEY;
  const ids = ['FACIO_WORKSPACE_ID', 'FACIO_PROGRAM_ID', 'FACIO_BINDER_ID'].map((name) =>
    z.string().uuid().safeParse(env[name]),
  );
  let url: URL;
  try {
    url = new URL(env.FACIO_API_BASE_URL || 'https://platform.facio.io');
  } catch {
    throw new BridgeError(503, 'FACIO_NOT_CONFIGURED', 'The Facio connection is not configured.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    ids.some((id) => !id.success) ||
    !apiKey ||
    !/^[a-f0-9]{64}$/i.test(env.FACIO_RECEIPT_KEY || '')
  )
    throw new BridgeError(
      503,
      'FACIO_NOT_CONFIGURED',
      'The published programme and secure Facio connection are not ready.',
    );
  return {
    baseUrl: url.origin,
    workspaceId: ids[0].data!,
    programId: ids[1].data!,
    binderId: ids[2].data!,
    apiKey,
    receiptKey: Buffer.from(env.FACIO_RECEIPT_KEY!, 'hex'),
  };
}
function seal(value: Receipt, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function unseal(value: string, key: Buffer, now: number): Receipt {
  try {
    const data = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const result = receiptSchema.parse(
      JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString()),
    );
    if (result.expiresAt <= now) throw new Error('Expired');
    return result;
  } catch {
    throw new BridgeError(
      409,
      'QUOTE_RECEIPT_INVALID',
      'This quote expired or changed. Request a new quote.',
    );
  }
}

/** Thin website adapter. Pricing, eligibility, authority and policy state stay in Facio. */
export function createFacioBridge(options: Options = {}) {
  const router = Router();
  const env = options.env ?? process.env;
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  async function upstream(
    config: Config,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await request(
        `${config.baseUrl}/api/v1/workspaces/${config.workspaceId}/insurance${path}`,
        {
          method: body === undefined ? 'GET' : 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(25000),
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
    } catch {
      throw new BridgeError(
        502,
        'FACIO_OUTCOME_UNCERTAIN',
        'Facio did not confirm the outcome. Retry this unchanged request; do not start another quote.',
      );
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = payload?.error;
      // Do not relay arbitrary upstream HTML, headers, credentials or infrastructure details.
      throw new BridgeError(
        response.status,
        typeof error?.code === 'string' ? error.code : 'FACIO_REQUEST_FAILED',
        response.status < 500 && typeof error?.message === 'string'
          ? error.message
          : 'Facio could not complete this request. Retry the unchanged request.',
        response.status < 500 ? error?.fieldErrors : undefined,
      );
    }
    if (!payload?.success || !object.safeParse(payload.data).success)
      throw new BridgeError(
        502,
        'FACIO_INVALID_RESPONSE',
        'Facio returned an incomplete response.',
      );
    return payload.data;
  }
  async function policyView(config: Config, policyId: string) {
    const state = await upstream(config, `/policies/${policyId}/status`);
    if (state.policyId !== policyId || typeof state.status !== 'string')
      throw new BridgeError(
        502,
        'FACIO_INVALID_STATUS',
        'Facio did not confirm the policy status.',
      );
    const riskTransactionId = z
      .string()
      .uuid()
      .nullable()
      .parse(state.riskTransactionId ?? null);
    const docs = riskTransactionId
      ? await upstream(
          config,
          `/policies/${policyId}/risk-transactions/${riskTransactionId}/documents`,
        )
      : null;
    const documentState = docs
      ? z
          .object({
            policyId: z.literal(policyId),
            riskTransactionId: z.literal(riskTransactionId!),
            status: z.enum(['pending', 'failed', 'ready']),
            documents: z.array(
              z.object({
                id: z.string().uuid(),
                type: z.string(),
                filename: z.string(),
                status: z.literal('GENERATED'),
              }),
            ),
          })
          .parse(docs)
      : null;
    return {
      policyId,
      status: state.status,
      policyNumber: typeof state.policyNumber === 'string' ? state.policyNumber : null,
      issuedAt: typeof state.issuedAt === 'string' ? state.issuedAt : null,
      riskTransactionId,
      documentsStatus: documentState?.status ?? 'pending',
      documents: documentState?.documents ?? [],
    };
  }
  const handle =
    (
      action: (req: import('express').Request, res: import('express').Response) => Promise<unknown>,
    ) =>
    async (req: import('express').Request, res: import('express').Response) => {
      res.set('Cache-Control', 'no-store');
      try {
        const data = await action(req, res);
        if (!res.headersSent) res.json({ success: true, data });
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'Review the submitted fields.',
              fieldErrors: error.issues.map((issue) => ({
                key: issue.path.join('.'),
                message: issue.message,
              })),
            },
          });
          return;
        }
        if (error instanceof BridgeError) {
          res.status(error.status).json({
            success: false,
            error: {
              code: error.code,
              message: error.message,
              ...(error.fields ? { fieldErrors: error.fields } : {}),
            },
          });
          return;
        }
        res.status(502).json({
          success: false,
          error: {
            code: 'FACIO_REQUEST_FAILED',
            message: 'The Facio request could not be completed.',
          },
        });
      }
    };
  router.get(
    '/quote',
    handle(async (req) => {
      z.object({}).strict().parse(req.query);
      const config = configuration(env);
      const data = await upstream(
        config,
        `/programmes/${config.programId}/intake?binderId=${config.binderId}`,
      );
      if (!object.safeParse(data.questionnaire).success || !Array.isArray(data.coverageOptions))
        throw new BridgeError(
          502,
          'FACIO_INTAKE_UNAVAILABLE',
          'The published rental form is unavailable.',
        );
      const {
        title,
        currency,
        initialQuoteData,
        questionnaire,
        coverageAnswerPath,
        coverageQuestionKey,
        coverageOptions,
      } = data;
      return {
        intake: {
          title,
          currency,
          initialQuoteData,
          questionnaire,
          coverageAnswerPath,
          coverageQuestionKey,
          coverageOptions,
        },
      };
    }),
  );
  router.post(
    '/quote',
    handle(async (req) => {
      const input = quoteBody.parse(req.body);
      const key = keySchema.parse(req.get('Idempotency-Key'));
      const config = configuration(env, input.channel === 'DIRECT' ? 'policy' : 'quote');
      const data = await upstream(
        config,
        '/quotes',
        { programId: config.programId, binderId: config.binderId, quoteData: input.quoteData },
        `website-${input.channel}-${key}`,
      );
      const { quoteToken, ...safe } = data;
      if (data.status !== 'QUOTED' || data.bindable !== true) return { ...safe, receipt: null };
      const expiresAt = Math.min(Date.parse(String(data.expiresAt)), now() + 30 * 60 * 1000);
      if (!Number.isFinite(expiresAt) || expiresAt <= now())
        throw new BridgeError(
          502,
          'FACIO_INVALID_QUOTE',
          'Facio did not return a valid quote expiry.',
        );
      const receipt = receiptSchema.parse({
        quoteId: data.quoteId,
        quoteToken,
        channel: input.channel,
        premium: data.premiumCalculated,
        currency: data.currency,
        expiresAt,
      });
      return { ...safe, receipt: seal(receipt, config.receiptKey) };
    }),
  );
  router.post(
    '/bind',
    handle(async (req, res) => {
      if (env.FACIO_CHECKOUT_ENABLED !== 'true')
        throw new BridgeError(
          503,
          'FACIO_BIND_NOT_READY',
          'Policy completion is awaiting the shared Facio release. No policy has been issued.',
        );
      const input = bindBody.parse(req.body);
      keySchema.parse(req.get('Idempotency-Key'));
      const config = configuration(env, 'policy');
      const receipt = unseal(input.receipt, config.receiptKey, now());
      if (receipt.channel !== 'DIRECT')
        throw new BridgeError(
          403,
          'QUOTE_ONLY_CHANNEL',
          'The partner demonstration stops at a retained quote.',
        );
      if (input.action === 'status' || input.action === 'document') {
        if (!receipt.policyAccess)
          throw new BridgeError(
            409,
            'COMPLETION_REQUIRED',
            'Complete the reviewed policy before retrieving its documents.',
          );
        const state = await policyView(config, receipt.quoteId);
        if (input.action === 'status') return { ...state, receipt: input.receipt };
        const document = state.documents.find((item) => item.id === input.documentId);
        if (state.documentsStatus !== 'ready' || !state.riskTransactionId || !document)
          throw new BridgeError(
            409,
            'DOCUMENT_NOT_READY',
            'The requested issued document is not ready. Refresh policy status.',
          );
        let response: Response;
        try {
          response = await request(
            `${config.baseUrl}/api/v1/workspaces/${config.workspaceId}/insurance/policies/${receipt.quoteId}/risk-transactions/${state.riskTransactionId}/documents/${document.id}/content`,
            {
              redirect: 'error',
              signal: AbortSignal.timeout(25000),
              headers: { Authorization: `Bearer ${config.apiKey}` },
            },
          );
        } catch {
          throw new BridgeError(
            502,
            'DOCUMENT_UNAVAILABLE',
            'Facio did not return the document. Retry the download.',
          );
        }
        if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf'))
          throw new BridgeError(
            502,
            'DOCUMENT_UNAVAILABLE',
            'Facio did not return a verified PDF document.',
          );
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 4 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-')
          throw new BridgeError(
            502,
            'DOCUMENT_UNAVAILABLE',
            'Facio returned an unsupported PDF document.',
          );
        const filename =
          document.filename.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 150) ||
          'policy-document.pdf';
        res
          .set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'X-Content-Type-Options': 'nosniff',
          })
          .send(bytes);
        return;
      }
      if (receipt.policyAccess)
        throw new BridgeError(
          409,
          'POLICY_ALREADY_COMPLETED',
          'Refresh this completed policy instead of repeating checkout.',
        );
      const path = `/quotes/${receipt.quoteId}/checkout`;
      const key = `website-${receipt.quoteId}`;
      if (input.action === 'review') {
        const review = reviewSchema.parse(
          await upstream(
            config,
            `${path}/review`,
            { quoteToken: receipt.quoteToken },
            `${key}-review`,
          ),
        );
        if (
          review.policyId !== receipt.quoteId ||
          review.workspaceId !== config.workspaceId ||
          review.premium !== receipt.premium ||
          review.currency !== receipt.currency
        )
          throw new BridgeError(
            409,
            'QUOTE_TOTAL_CHANGED',
            'The retained quote changed. Request and review a new quote.',
          );
        return {
          review: {
            premium: review.premium,
            currency: review.currency,
            offerId: review.offerId,
            quoteVersionId: review.quoteVersionId,
            paymentMode: review.paymentMode,
          },
          receipt: seal({ ...receipt, review }, config.receiptKey),
        };
      }
      const review = receipt.review;
      if (!review)
        throw new BridgeError(
          409,
          'REVIEW_REQUIRED',
          'Review the retained offer before confirming this policy.',
        );
      const pins = {
        offerId: review.offerId,
        quoteVersionId: review.quoteVersionId,
        expectedCurrentHash: review.currentHash,
        expectedDefinitionHash: review.definition.hash,
        confirmed: true,
      };
      // Each phase replays exactly. Never skip to issue, invent acceptance, or substitute a local payment success.
      await upstream(
        config,
        `${path}/accept`,
        {
          ...pins,
          expectedVersionHash: review.expectedVersionHash,
          reason:
            'Customer explicitly confirmed the displayed retained offer on the Bonzah demonstration website.',
        },
        `${key}-accept`,
      );
      await upstream(
        config,
        `${path}/test-payment`,
        {
          quoteToken: receipt.quoteToken,
          expectedDefinitionHash: review.definition.hash,
          outcome: 'SIMULATED',
        },
        `${key}-payment`,
      );
      await upstream(
        config,
        `${path}/complete`,
        { ...pins, quoteToken: receipt.quoteToken },
        `${key}-complete`,
      );
      const state = await policyView(config, receipt.quoteId);
      if (!state.issuedAt || !['ISSUED', 'ACTIVE'].includes(state.status))
        throw new BridgeError(
          409,
          'ISSUANCE_NOT_CONFIRMED',
          'Facio has not confirmed issuance. Retry this unchanged completion request.',
        );
      return {
        ...state,
        receipt: seal(
          { ...receipt, policyAccess: true, expiresAt: now() + 24 * 60 * 60 * 1000 },
          config.receiptKey,
        ),
      };
    }),
  );
  return router;
}
