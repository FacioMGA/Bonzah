import express from 'express';

import { createBonzahPartnerRouter, createBonzahPublicRouter } from '../backend/modules/bonzah/http/bonzahRouter.js';
import { registerAllProducts } from '../backend/products/registerProducts.js';
import { createKernelRentalProxyRouter } from './kernelRentalProxy.js';

registerAllProducts();

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'bonzah-demo' });
});
app.use('/api/public/bonzah', createKernelRentalProxyRouter());
app.use('/api/public/bonzah', createBonzahPublicRouter());
app.use('/api/v1/bonzah', createBonzahPartnerRouter());

export default app;
