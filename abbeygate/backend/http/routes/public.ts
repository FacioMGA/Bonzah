import { RequestHandler, Router } from 'express';

import authRouter from '../../modules/auth/http/authRouter.js';
import paymentsCardcorpRouter from './paymentsCardcorp.js';
import publicDocumentsRouter from './publicDocuments.js';
import publicFnolRouter from './publicFnol.js';
import publicVehiclesRouter from './publicVehicles.js';
import vehicleEnrichmentRouter from './vehicleEnrichment.js';
import publicV1Router from './v1/index.js';
import webhooksRouter from './webhooks.js';
import { createGenericPublicQuoteRouter } from '../../modules/quotes/http/genericPublicQuoteRouter.js';
import { listPublicQuoteSessionProducts } from '../../modules/quotes/app/publicQuoteProducts.js';
import { createTenantResolveRouter } from '../../modules/tenant/http/tenantResolveRouter.js';
import { createProductChannelPublicRouter } from '../../modules/policy/http/productChannelPublicRouter.js';
import { createPublicIpidRouter } from '../../modules/policy/http/publicIpidRouter.js';
import { createBonzahPublicRouter } from '../../modules/bonzah/http/bonzahRouter.js';

type PublicRouteDeps = {
  publicLimiter: RequestHandler;
  publicQuoteSessionLimiter: RequestHandler;
  publicApiLimiter: RequestHandler;
  publicApiDocsLimiter: RequestHandler;
  webhookLimiter: RequestHandler;
  readinessPollingLimiter: RequestHandler;
};

export function createPublicApiRouter(deps: PublicRouteDeps) {
  const router = Router();
  const {
    publicLimiter,
    publicQuoteSessionLimiter,
    publicApiLimiter,
    publicApiDocsLimiter,
    webhookLimiter,
    readinessPollingLimiter,
  } = deps;

  router.use('/tenant', createTenantResolveRouter());

  router.use('/auth', publicLimiter, authRouter);

  for (const product of listPublicQuoteSessionProducts()) {
    const slug = product.publicSessionSlug;
    router.use(`/public/${slug}/session/:token/issue-readiness`, readinessPollingLimiter);
    router.use(`/public/${slug}/session`, publicQuoteSessionLimiter, createGenericPublicQuoteRouter(product.productType));
  }

  router.use('/public/product-channels', publicLimiter, createProductChannelPublicRouter());
  router.use('/public/bonzah', publicLimiter, createBonzahPublicRouter());

  router.use('/public/vehicles', publicVehiclesRouter);
  router.use('/vehicle-enrichment', publicLimiter, vehicleEnrichmentRouter);

  router.use('/public/payments/cardcorp/webhook', webhookLimiter);
  router.use('/public/payments/cardcorp', paymentsCardcorpRouter);
  router.use('/public/documents', publicDocumentsRouter);
  router.use('/public/ipid', createPublicIpidRouter());
  router.use('/public/fnol', publicFnolRouter);

  router.use('/webhooks', webhookLimiter, webhooksRouter);

  router.use('/v1/docs', publicApiDocsLimiter);
  router.use('/v1/webhooks', webhookLimiter);
  router.use('/v1', publicApiLimiter, publicV1Router);

  return router;
}
