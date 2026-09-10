import express from 'express';

import { createFacioBridge } from '../website/facioBridge.js';
import { summitVehicles } from '../backend/products/rental/goldenFixtures.js';

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'bonzah-demo', buildSha: process.env.VERCEL_GIT_COMMIT_SHA || null, checkoutEnabled: process.env.FACIO_CHECKOUT_ENABLED === 'true' });
});
app.use('/api', createFacioBridge());
// Fleet merchandising is static; no local insurance pricing or binding service is mounted.
app.get('/api/public/bonzah/vehicles', (_req, res) => res.json({ success: true, data: summitVehicles }));

export default app;
