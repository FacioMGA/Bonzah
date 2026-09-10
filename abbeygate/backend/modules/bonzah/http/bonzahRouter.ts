import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { typedHandler } from '../../../platform/http/typedHandler.js';
import { rentalBindBodySchema, rentalPricePreviewBodySchema, rentalQuoteBodySchema, quoteParamsSchema, policyParamsSchema, policyDocumentParamsSchema } from '../domain/schemas.js';
import { bindRentalQuote, BonzahDemoError, createRentalQuote, getRentalPolicy, getRentalPolicyDocument, getRentalQuote } from '../app/quoteService.js';
import { demoQuoteStore } from '../app/quoteStore.js';
import { summitVehicles } from '../../../products/rental/goldenFixtures.js';
import { bonzahDemoFixtures } from '../../../products/rental/demoFixtures.js';
import { calculateRentalPricePreview, RentalRatingError } from '../../../products/rental/pricing/calculator.js';

const header = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? '' : value ?? '';
const sendError = (res: Parameters<Parameters<typeof typedHandler>[1]>[1], error: unknown) => {
  if (error instanceof BonzahDemoError) { res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } }); return; }
  throw error;
};

const partnerAuth: RequestHandler = (req, res, next) => {
  const enabled = process.env.NODE_ENV !== 'production' || process.env.BONZAH_DEMO_ENABLED === 'true';
  const expected = process.env.BONZAH_DEMO_PARTNER_TOKEN || 'bonzah-demo-local-token';
  if (!enabled) { res.status(404).json({ success: false, error: { code: 'DEMO_DISABLED', message: 'Demo API is disabled.' } }); return; }
  if (process.env.NODE_ENV === 'production' && !process.env.BONZAH_DEMO_PARTNER_TOKEN) { res.status(503).json({ success: false, error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'Partner authentication is not configured.' } }); return; }
  if (header(req.headers.authorization) !== `Bearer ${expected}`) { res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'A valid demo bearer token is required.' } }); return; }
  if (!header(req.headers['x-partner-id'])) { res.status(400).json({ success: false, error: { code: 'PARTNER_REQUIRED', message: 'X-Partner-Id is required.' } }); return; }
  next();
};

function createRouter(partnerMode: boolean) {
  const router = Router();
  if (partnerMode) router.use(partnerAuth);
  router.get('/vehicles', (_req, res) => res.json({ success: true, data: summitVehicles, demoStatus: 'DEMO BUILD' }));
  router.get('/demo/configuration', (_req, res) => res.json({ success: true, data: bonzahDemoFixtures, demoStatus: 'DEMO BUILD' }));
  router.post('/price-preview', typedHandler({ body: rentalPricePreviewBodySchema }, (req, res) => {
    try {
      if (process.env.BONZAH_EXECUTION_MODE === 'insillion') throw new BonzahDemoError(409, 'PROVIDER_PREVIEW_REQUIRES_QUOTE', 'Use the quotes endpoint for provider pricing; this preview endpoint is simulation-only.');
      const preview = calculateRentalPricePreview(rentalPricePreviewBodySchema.parse(req.body));
      res.json({ success: true, data: { chargedPeriods: preview.chargedPeriods, vehicleMultiplier: preview.vehicleMultiplier, factors: preview.factors, ratingSource: preview.ratingSource, coverages: preview.coveragePrices, subtotal: preview.subtotal, fees: preview.fees, feeComponents: preview.feeComponents, tax: preview.tax, total: preview.total, currency: preview.currency, demoStatus: 'DEMO BUILD' } });
    } catch (error) { sendError(res, error instanceof RentalRatingError ? new BonzahDemoError(422, error.code, error.message) : error); }
  }));
  router.post('/quotes', typedHandler({ body: rentalQuoteBodySchema }, async (req, res) => {
    try {
      const quoteRequest = rentalQuoteBodySchema.parse(req.body);
      const idempotencyKey = header(req.headers['idempotency-key']);
      if (partnerMode && !idempotencyKey) { res.status(400).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required.' } }); return; }
      const data = await createRentalQuote({ request: quoteRequest, partnerId: header(req.headers['x-partner-id']) || 'summit-rentals-demo', idempotencyKey: idempotencyKey || crypto.randomUUID(), correlationId: header(req.headers['x-correlation-id']) || undefined });
      res.status(201).json({ success: true, data });
    } catch (error) { sendError(res, error); }
  }));
  router.get('/quotes/:quoteId', typedHandler({ params: quoteParamsSchema }, (req, res) => {
    try { res.json({ success: true, data: getRentalQuote(req.params.quoteId, header(req.headers['x-partner-id']) || 'summit-rentals-demo') }); } catch (error) { sendError(res, error); }
  }));
  router.post('/quotes/:quoteId/bind', typedHandler({ params: quoteParamsSchema, body: rentalBindBodySchema }, async (req, res) => {
    try {
      const bindRequest = rentalBindBodySchema.parse(req.body);
      const idempotencyKey = header(req.headers['idempotency-key']);
      if (!idempotencyKey) { res.status(400).json({ success: false, error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key is required.' } }); return; }
      const data = await bindRentalQuote({ quoteId: req.params.quoteId, partnerId: header(req.headers['x-partner-id']) || 'summit-rentals-demo', idempotencyKey, ...bindRequest });
      res.json({ success: true, data });
    } catch (error) { sendError(res, error); }
  }));
  if (partnerMode) {
    router.get('/policies/:policyId', typedHandler({ params: policyParamsSchema }, (req, res) => {
      try { res.json({ success: true, data: getRentalPolicy(req.params.policyId, header(req.headers['x-partner-id'])) }); } catch (error) { sendError(res, error); }
    }));
    router.get('/policies/:policyId/documents/:coverage', typedHandler({ params: policyDocumentParamsSchema }, async (req, res) => {
      try {
        const upstream = await getRentalPolicyDocument(req.params.policyId, req.params.coverage, header(req.headers['x-partner-id']));
        res.status(upstream.status);
        res.setHeader('content-type', upstream.headers.get('content-type') || 'application/pdf');
        res.setHeader('content-disposition', upstream.headers.get('content-disposition') || `attachment; filename="${req.params.coverage}-policy.pdf"`);
        res.send(Buffer.from(await upstream.arrayBuffer()));
      } catch (error) { sendError(res, error); }
    }));
  }
  router.post('/demo/reset', (req, res) => {
    if (process.env.BONZAH_EXECUTION_MODE === 'insillion') { res.status(403).json({ success: false, error: { code: 'RESET_FORBIDDEN', message: 'Provider operation records cannot be reset through the demo API.' } }); return; }
    const enabled = process.env.NODE_ENV !== 'production' || process.env.BONZAH_DEMO_ENABLED === 'true';
    const expected = process.env.BONZAH_DEMO_RESET_TOKEN || 'bonzah-demo-reset-local';
    if (!enabled || header(req.headers['x-demo-reset-token']) !== expected) { res.status(403).json({ success: false, error: { code: 'RESET_FORBIDDEN', message: 'Demo reset is not authorized.' } }); return; }
    demoQuoteStore.reset(); res.json({ success: true, demoStatus: 'DEMO BUILD', message: 'Synthetic Bonzah fixtures reset.' });
  });
  return router;
}

export const createBonzahPublicRouter = () => createRouter(false);
export const createBonzahPartnerRouter = () => createRouter(true);
