import type { BdxGap, BdxRowDto } from '../types.js';

export type ProductBdxValidator = (dto: BdxRowDto) => BdxGap[];

export function productGap(
  dto: BdxRowDto,
  message: string,
  rootCauseHint?: string,
): BdxGap {
  return {
    rowId: dto.sourceId,
    policyRef: dto.policyRef,
    category: 'MAPPING',
    severity: 'Critical',
    message,
    rootCauseHint,
  };
}
