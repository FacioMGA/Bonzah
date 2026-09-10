import type { BdxRowDto } from '../types.js';
import { productGap, type ProductBdxValidator } from './shared.js';

export const validateHomeBdxRow: ProductBdxValidator = (dto: BdxRowDto) => {
  const gaps = [];
  const quoteData = dto.productData as Record<string, unknown> | undefined;
  const property = quoteData?.property as Record<string, unknown> | undefined;
  const coverage = quoteData?.coverage as Record<string, unknown> | undefined;
  if (!property?.propertyType) {
    gaps.push(productGap(dto, 'Missing home property type', 'Home BDX rows must map Property Type into property.propertyType.'));
  }
  const buildings = Number(coverage?.buildings || 0);
  const contents = Number(coverage?.contents || 0);
  if (buildings <= 0 && contents <= 0) {
    gaps.push(productGap(dto, 'Missing home buildings or contents sum insured', 'At least one Home coverage sum insured must be present.'));
  }
  return gaps;
};
