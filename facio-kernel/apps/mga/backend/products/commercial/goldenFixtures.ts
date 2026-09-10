import type { ProductGoldenFixtures } from '../../modules/policy/domain/productContracts.js';
/** Explicit source-free test input. Product rates and authority are supplied separately. */
export const commercialGoldenFixtures: ProductGoldenFixtures = { minimumValid: {
  proposer: { companyName: 'Synthetic training business', firstName: 'Test', lastName: 'Operator', email: 'training@example.invalid', phone: '+440000000000', address: { line1: 'Synthetic location', city: 'Test city', country: 'GB' } },
  policy: { startDate: '2027-01-01', endDate: '2028-01-01' },
  commercial: { turnover: 100000, segmentId: 'training-business', coverages: [{ coverage: 'Training liability', limit: 100000, excess: 100 }] },
} };
