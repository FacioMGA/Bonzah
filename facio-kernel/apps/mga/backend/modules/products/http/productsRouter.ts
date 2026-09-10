import { Router } from 'express';
import { resolveProductAvailability } from '../../jurisdiction/app/productAvailability.js';
import { prisma } from '../../../platform/db/connection.js';

const router = Router();

router.get('/', async (_req, res) => {
  const products = await prisma.productDefinition.findMany({
    where: { isActive: true },
    orderBy: { displayName: 'asc' },
  });
  const availableProducts = products.filter((product) => resolveProductAvailability(product.code).available);
  return res.json({ success: true, data: availableProducts });
});

router.get('/:code', async (req, res) => {
  if (!resolveProductAvailability(req.params.code).available) {
    return res.status(404).json({ success: false, error: { message: 'Product not found' } });
  }
  const product = await prisma.productDefinition.findUnique({
    where: { code: req.params.code.toUpperCase() },
  });
  if (!product) {
    return res.status(404).json({ success: false, error: { message: 'Product not found' } });
  }
  return res.json({ success: true, data: product });
});

export default router;
