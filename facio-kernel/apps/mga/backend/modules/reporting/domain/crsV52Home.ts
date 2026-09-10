import {
  CRS_V52_MOTOR_CLAIMS_COLUMNS,
  CRS_V52_MOTOR_PREMIUM_COLUMNS,
  CRS_V52_MOTOR_RISK_COLUMNS,
  type ClaimsRowCtx,
  type CsrColumnSpec,
  type PremiumRowCtx,
  type RiskRowCtx,
} from './crsV52Motor.js';

// Home CRS v5.2 is deliberately a limited product projection over the
// canonical Motor column model until product-owned Home CRS mappings are signed
// off. Do not treat this as a second full CRS spine.

function readPath(record: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, segment) => {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    return (cur as Record<string, unknown>)[segment];
  }, record);
}

const HOME_EXCLUDED_MOTOR_RISK_KEYS = new Set([
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

export const CRS_V52_HOME_RISK_COLUMNS: Array<CsrColumnSpec<RiskRowCtx>> = [
  ...CRS_V52_MOTOR_RISK_COLUMNS.filter((column) => !HOME_EXCLUDED_MOTOR_RISK_KEYS.has(column.key)),
  {
    key: 'homePropertyAddress',
    title: 'Property Address',
    requiredness: 'optional',
    validationSeverity: 'info',
    sourceEntity: 'policy',
    sourceField: 'quoteData.property.address',
    sourcePath: '$.property.address.line1',
    sourceKind: 'json_snapshot',
    get: (c) => [
      readPath(c.quoteData as Record<string, unknown>, 'property.address.line1'),
      readPath(c.quoteData as Record<string, unknown>, 'property.address.city'),
      readPath(c.quoteData as Record<string, unknown>, 'property.address.country'),
    ].map((part) => String(part || '').trim()).filter(Boolean).join(', '),
  },
  {
    key: 'homePropertyType',
    title: 'Property Type',
    requiredness: 'optional',
    validationSeverity: 'info',
    sourceEntity: 'policy',
    sourceField: 'quoteData.property.propertyType',
    sourcePath: '$.property.propertyType',
    sourceKind: 'json_snapshot',
    get: (c) => readPath(c.quoteData as Record<string, unknown>, 'property.propertyType') || '',
  },
  {
    key: 'cr0052',
    crCode: 'CR0052',
    title: 'CR0052 Sum Insured Amount',
    requiredness: 'conditional',
    validationSeverity: 'warning',
    sourceEntity: 'policy',
    sourceField: 'quoteData.coverage',
    sourcePath: '$.coverage.buildings',
    sourceKind: 'computed',
    applicabilityKey: 'risk_level_financials_included',
    derivationRule: 'Buildings + contents sums insured when supplied',
    get: (c) => {
      const quoteData = c.quoteData as Record<string, unknown>;
      const buildings = Number(readPath(quoteData, 'coverage.buildings') || 0);
      const contents = Number(readPath(quoteData, 'coverage.contents') || 0);
      const total = buildings + contents;
      return Number.isFinite(total) && total > 0 ? total : '';
    },
  },
];

export const CRS_V52_HOME_PREMIUM_COLUMNS: Array<CsrColumnSpec<PremiumRowCtx>> = CRS_V52_MOTOR_PREMIUM_COLUMNS;
export const CRS_V52_HOME_CLAIMS_COLUMNS: Array<CsrColumnSpec<ClaimsRowCtx>> = CRS_V52_MOTOR_CLAIMS_COLUMNS;
