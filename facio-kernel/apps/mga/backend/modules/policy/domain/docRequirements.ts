export type DocPack = 'QUOTE_PACK' | 'ISSUED_POLICY_PACK' | 'ENDORSEMENT_PACK';

export type RequirementChannel = 'bo' | 'customer';

export type RequiredField = {
  // Slug-ish name that matches template semantics (not yet backed by MagicB registry for motor).
  slug: string;
  label: string;
  // Where we expect to find the value (currently quoteData; can expand later).
  source: 'quoteData';
  path: string; // e.g. "email" or "addressLine"
  // UI hints
  customerHash?: string; // e.g. "your-details"
  boTab?: string; // e.g. "Premium"
  visibleWhenKey?: string;
  visibleWhenValue?: unknown;
  requiredWhenKey?: string;
  requiredWhenValue?: unknown;
};
import { selectRequiredFieldsForDocPack } from './productFieldRequirements.js';

export function requiredFieldsForDocPack(productType: string, docPack: DocPack): RequiredField[] {
  return selectRequiredFieldsForDocPack(productType, docPack);
}

