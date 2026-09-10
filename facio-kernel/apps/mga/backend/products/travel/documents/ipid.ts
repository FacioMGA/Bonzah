import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecord } from '../../../platform/json/parseRecord.js';
import type { ProductIpidSelectionContext } from '../../../modules/policy/domain/productContracts.js';

const STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');

export const TRAVEL_IPID_ASSETS = {
  single_trip: {
    filename: 'Travel_Single_Trip_IPID.pdf',
    staticPdfPath: path.join(STATIC_DIR, 'Brit_Travel_SingleTrip_IPID.pdf'),
    assetVersion: 'brit-travel-singletrip-ipid:2025',
  },
  annual_multi_trip: {
    filename: 'Travel_Annual_Multi_Trip_IPID.pdf',
    staticPdfPath: path.join(STATIC_DIR, 'Brit_Travel_AnnualMultiTrip_IPID.pdf'),
    assetVersion: 'brit-travel-annual-multitrip-ipid:2025:2378c1cc71b86cce',
  },
} as const;

type TravelIpidVariant = keyof typeof TRAVEL_IPID_ASSETS;

function requireVariant(value: unknown): TravelIpidVariant {
  if (value === 'single_trip' || value === 'annual_multi_trip') return value;
  throw new Error('TRAVEL_IPID_SELECTION_REQUIRED: select single_trip or annual_multi_trip for the Travel IPID');
}

/** ADR-0099: every Travel disclosure resolves its exact selected trip type. */
export function resolveTravelIpid(selection: ProductIpidSelectionContext = {}) {
  const quoteVariant = selection.quoteData === undefined
    ? undefined
    : requireVariant(parseRecord(parseRecord(selection.quoteData).trip).planType);
  const explicitVariant = selection.variant === undefined ? undefined : requireVariant(selection.variant);
  if (quoteVariant && explicitVariant && quoteVariant !== explicitVariant) {
    throw new Error('TRAVEL_IPID_SELECTION_CONFLICT: the IPID variant does not match the selected trip type');
  }
  return TRAVEL_IPID_ASSETS[requireVariant(quoteVariant ?? explicitVariant)];
}
