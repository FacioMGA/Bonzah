import express from 'express';
import { createBonzahPartnerRouter, createBonzahPublicRouter } from '../../backend/modules/bonzah/http/bonzahRouter.js';
import { registerAllProducts } from '../../backend/products/registerProducts.js';

registerAllProducts();

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use('/api/public/bonzah', createBonzahPublicRouter());
app.use('/api/v1/bonzah', createBonzahPartnerRouter());

const port = Number(process.env.PORT || 3001);
app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Bonzah reference API listening on http://127.0.0.1:${port}\n`);
});
