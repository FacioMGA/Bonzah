import {
  CRS_V52_MOTOR_CLAIMS_COLUMNS,
  CRS_V52_MOTOR_PREMIUM_COLUMNS,
  CRS_V52_MOTOR_RISK_COLUMNS,
  type ClaimsRowCtx,
  type CsrColumnSpec,
  type PremiumRowCtx,
  type RiskRowCtx,
} from './crsV52Motor.js';

// Travel CRS v5.2 is deliberately a limited product projection over the
// canonical Motor column model until product-owned Travel CRS mappings are
// signed off. Do not treat this as a second full CRS spine.

function readPath(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, segment) => {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    return (cur as Record<string, unknown>)[segment];
  }, record);
}

function joined(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).join(', ');
  return String(value || '').trim();
}

const TRAVEL_EXCLUDED_MOTOR_RISK_KEYS = new Set([
  'cr0226',
  'cr0033',
  'cr1275',
  'cr0377',
  'vehicleMake',
  'vehicleModel',
  'vehicleYear',
  'engineSize',
  'cr0052',
  'ncd',
  'cr0054',
]);

export const CRS_V52_TRAVEL_RISK_COLUMNS: Array<CsrColumnSpec<RiskRowCtx>> = [
  ...CRS_V52_MOTOR_RISK_COLUMNS.filter((column) => !TRAVEL_EXCLUDED_MOTOR_RISK_KEYS.has(column.key)),
  {
    key: 'travelDestination',
    title: 'Travel Destinations',
    requiredness: 'optional',
    validationSeverity: 'info',
    sourceEntity: 'policy',
    sourceField: 'quoteData.trip.destinations',
    sourcePath: '$.trip.destinations',
    sourceKind: 'json_snapshot',
    get: (c) => joined(readPath(c.quoteData as Record<string, unknown>, 'trip.destinations')),
  },
  {
    key: 'travelPlanType',
    title: 'Travel Plan Type',
    requiredness: 'optional',
    validationSeverity: 'info',
    sourceEntity: 'policy',
    sourceField: 'quoteData.trip.planType',
    sourcePath: '$.trip.planType',
    sourceKind: 'json_snapshot',
    get: (c) => readPath(c.quoteData as Record<string, unknown>, 'trip.planType') || '',
  },
  {
    key: 'travelCoverType',
    title: 'Travel Cover Type',
    requiredness: 'optional',
    validationSeverity: 'info',
    sourceEntity: 'policy',
    sourceField: 'quoteData.travellers.coverType',
    sourcePath: '$.travellers.coverType',
    sourceKind: 'json_snapshot',
    get: (c) => readPath(c.quoteData as Record<string, unknown>, 'travellers.coverType') || '',
  },
  {
    key: 'cr0052',
    crCode: 'CR0052',
    title: 'CR0052 Sum Insured Amount',
    requiredness: 'conditional',
    validationSeverity: 'warning',
    sourceEntity: 'policy',
    sourceField: 'quoteData.quote.coverLimit',
    sourcePath: '$.quote.coverLimit',
    sourceKind: 'json_snapshot',
    applicabilityKey: 'risk_level_financials_included',
    get: (c) => readPath(c.quoteData as Record<string, unknown>, 'quote.coverLimit') || '',
  },
];

export const CRS_V52_TRAVEL_PREMIUM_COLUMNS: Array<CsrColumnSpec<PremiumRowCtx>> = CRS_V52_MOTOR_PREMIUM_COLUMNS;
export const CRS_V52_TRAVEL_CLAIMS_COLUMNS: Array<CsrColumnSpec<ClaimsRowCtx>> = CRS_V52_MOTOR_CLAIMS_COLUMNS;
