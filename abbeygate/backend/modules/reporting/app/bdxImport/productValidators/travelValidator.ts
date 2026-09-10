import type { BdxRowDto } from '../types.js';
import { productGap, type ProductBdxValidator } from './shared.js';

export const validateTravelBdxRow: ProductBdxValidator = (dto: BdxRowDto) => {
  const gaps = [];
  const quoteData = dto.productData as Record<string, unknown> | undefined;
  const trip = quoteData?.trip as Record<string, unknown> | undefined;
  const travellers = quoteData?.travellers as Record<string, unknown> | undefined;
  // Lloyds v5.2 BDX makes Certificate Ref mandatory on every travel risk
  // row — it's the only column that uniquely identifies a traveller/trip.
  // The mapper resolves policyRef from Certificate Ref ALONE (no Group
  // Ref / Broker's Ref fallback) — see
  // `.cursor/skills/no-defensive-fallbacks/SKILL.md`. If policyRef is
  // empty here the source row didn't carry a Certificate Ref; the
  // generic structural/completeness validators already emit Critical
  // gaps, this gap just spells out which column the operator should
  // populate.
  if (!dto.policyRef || dto.policyRef.trim() === '') {
    gaps.push(productGap(
      dto,
      "Missing required column 'Certificate Ref'",
      "Lloyds v5.2 BDX requires a unique Certificate Ref per travel risk row. Populate the column in the source workbook and re-import — Group Ref / Broker's Ref are operator metadata and are not accepted as the policy identifier.",
    ));
  }
  if (!trip?.startDate || !trip?.endDate) {
    gaps.push(productGap(dto, 'Missing travel trip dates', 'Travel BDX rows must map From/To dates into trip.startDate/trip.endDate.'));
  }
  if (!travellers?.leadTravellerDOB) {
    gaps.push(productGap(dto, 'Missing lead traveller date of birth', 'Travel rating requires at least Traveller 1 DOB.'));
  }
  return gaps;
};
