import { Router } from 'express';
import { prisma } from '../../../platform/db/connection.js';

const router = Router();

router.get('/', async (_req, res) => {
  const products = await prisma.productDefinition.findMany({
    where: { isActive: true },
    orderBy: { displayName: 'asc' },
  });
  return res.json({ success: true, data: products });
});

router.get('/:code', async (req, res) => {
  const product = await prisma.productDefinition.findUnique({
    where: { code: req.params.code.toUpperCase() },
  });
  if (!product) {
    return res.status(404).json({ success: false, error: { message: 'Product not found' } });
  }
  return res.json({ success: true, data: product });
});

export default router;
