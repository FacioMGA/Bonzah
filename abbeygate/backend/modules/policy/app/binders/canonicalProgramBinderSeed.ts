export type CanonicalProductCode = 'MOTOR' | 'HOME' | 'TRAVEL' | 'HEALTH' | 'BUSINESS' | 'OPEN_MARKET';

export type CanonicalProgramSeed = {
  id: string;
  productCode: CanonicalProductCode;
  name: string;
  displayName: string;
  icon: string;
};

export type CanonicalBinderSeed = {
  id: string;
  productCode: CanonicalProductCode;
  authorizedProductCodes?: CanonicalProductCode[];
  agreementNumber: string;
  umr: string;
  coverholderName: string;
  coverholderPin: string;
  leadName: string;
  startDate: Date;
  endDate: Date;
  classOfBusiness: string;
  riskCode: string;
  authorityClasses: string[];
  territorialScope: string[];
  config: Record<string, unknown>;
};

export const LEGACY_MOTOR_BINDER_ID = 'ABBEYGATE0125-BINDER';

export const CANONICAL_PROGRAMS: Record<CanonicalProductCode, CanonicalProgramSeed> = {
  MOTOR: {
    id: '11111111-1111-4111-8111-111111111111',
    productCode: 'MOTOR',
    name: 'Abbeygate Motor Comprehensive',
    displayName: 'Motor Insurance',
    icon: 'car',
  },
  HOME: {
    id: '22222222-2222-4222-8222-222222222222',
    productCode: 'HOME',
    name: 'Abbeygate Home Standard',
    displayName: 'Home Insurance',
    icon: 'home',
  },
  TRAVEL: {
    id: '33333333-3333-4333-8333-333333333333',
    productCode: 'TRAVEL',
    name: 'Abbeygate Travel Standard',
    displayName: 'Travel Insurance',
    icon: 'plane',
  },
  HEALTH: {
    id: '44444444-4444-4444-8444-444444444444',
    productCode: 'HEALTH',
    name: 'Abbeygate Immigration Medical',
    displayName: 'Immigration Medical Insurance',
    icon: 'heart-pulse',
  },
  BUSINESS: {
    id: '55555555-5555-4555-8555-555555555555',
    productCode: 'BUSINESS',
    name: 'Abbeygate Business Manual',
    displayName: 'Business Insurance',
    icon: 'briefcase-business',
  },
  OPEN_MARKET: {
    id: '66666666-6666-4666-8666-666666666666',
    productCode: 'OPEN_MARKET',
    name: 'Abbeygate Open Market Manual',
    displayName: 'Open Market',
    icon: 'file-pen-line',
  },
};

export const CANONICAL_BINDERS: CanonicalBinderSeed[] = [
  {
    id: 'ABBEYGATE0125-BINDER-2024',
    productCode: 'MOTOR',
    agreementNumber: 'ABBEYGATE0125-2024',
    umr: 'B176024EEA6152',
    coverholderName: 'Abbeygate UW Ltd.',
    coverholderPin: '115933OFE',
    leadName: 'Volante',
    startDate: new Date('2024-01-01T00:00:00.000Z'),
    endDate: new Date('2024-12-31T23:59:59.999Z'),
    classOfBusiness: 'MOTOR',
    riskCode: 'MC',
    authorityClasses: ['TPBI', 'TPPD', 'OD'],
    territorialScope: ['CY'],
    config: { productType: 'MOTOR', scope: { authorizedClass: 'Motor', riskLocationCountries: ['CY'] } },
  },
  {
    id: 'ABBEYGATE0125-BINDER-2025',
    productCode: 'MOTOR',
    agreementNumber: 'ABBEYGATE0125-2025',
    umr: 'B176025EEA6152',
    coverholderName: 'Abbeygate UW Ltd.',
    coverholderPin: '115933OFE',
    leadName: 'Volante',
    startDate: new Date('2025-01-01T00:00:00.000Z'),
    endDate: new Date('2025-12-31T23:59:59.999Z'),
    classOfBusiness: 'MOTOR',
    riskCode: 'MC',
    authorityClasses: ['TPBI', 'TPPD', 'OD'],
    territorialScope: ['CY'],
    config: { productType: 'MOTOR', scope: { authorizedClass: 'Motor', riskLocationCountries: ['CY'] } },
  },
  {
    id: 'ABBEYGATE0125-BINDER-2026',
    productCode: 'MOTOR',
    agreementNumber: 'ABBEYGATE0125-2026',
    umr: 'B176026EEA6152',
    coverholderName: 'Abbeygate UW Ltd.',
    coverholderPin: '115933OFE',
    leadName: 'Volante',
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-12-31T23:59:59.999Z'),
    classOfBusiness: 'MOTOR',
    riskCode: 'MC',
    authorityClasses: ['TPBI', 'TPPD', 'OD'],
    territorialScope: ['CY'],
    config: { productType: 'MOTOR', scope: { authorizedClass: 'Motor', riskLocationCountries: ['CY'] } },
  },
  {
    id: 'HOME-23EEA6551',
    productCode: 'HOME',
    agreementNumber: '23EEA6551',
    umr: 'B176023EEA6551',
    coverholderName: 'Abbeygate Insurance Brokers Limited',
    coverholderPin: '115933OFE',
    leadName: 'Beazley',
    startDate: new Date('2023-11-10T00:00:00.000Z'),
    endDate: new Date('2024-11-09T23:59:59.999Z'),
    classOfBusiness: 'PROPERTY',
    riskCode: 'HH',
    authorityClasses: [],
    territorialScope: ['CY', 'ES', 'PT', 'GR'],
    config: { productType: 'HOME', scope: { authorizedClass: 'Home', riskLocationCountries: ['CY', 'ES', 'PT', 'GR'] } },
  },
  {
    id: 'HOME-24EEA6551',
    productCode: 'HOME',
    agreementNumber: '24EEA6551',
    umr: 'B176024EEA6551',
    coverholderName: 'Abbeygate Insurance Brokers Limited',
    coverholderPin: '115933OFE',
    leadName: 'Beazley',
    startDate: new Date('2024-11-10T00:00:00.000Z'),
    endDate: new Date('2025-11-09T23:59:59.999Z'),
    classOfBusiness: 'PROPERTY',
    riskCode: 'HH',
    authorityClasses: [],
    territorialScope: ['CY', 'ES', 'PT', 'GR'],
    config: { productType: 'HOME', scope: { authorizedClass: 'Home', riskLocationCountries: ['CY', 'ES', 'PT', 'GR'] } },
  },
  {
    id: 'HOME-25EEA6551',
    productCode: 'HOME',
    agreementNumber: '25EEA6551',
    umr: 'B176025EEA6551',
    coverholderName: 'Abbeygate Insurance Brokers Limited',
    coverholderPin: '115933OFE',
    leadName: 'Beazley',
    startDate: new Date('2025-11-10T00:00:00.000Z'),
    endDate: new Date('2026-11-09T23:59:59.999Z'),
    classOfBusiness: 'PROPERTY',
    riskCode: 'HH',
    authorityClasses: [],
    territorialScope: ['CY', 'ES', 'PT', 'GR'],
    config: { productType: 'HOME', scope: { authorizedClass: 'Home', riskLocationCountries: ['CY', 'ES', 'PT', 'GR'] } },
  },
  {
    id: 'HOME-26EEA6551',
    productCode: 'HOME',
    agreementNumber: '26EEA6551',
    umr: 'B176026EEA6551',
    coverholderName: 'Abbeygate Insurance Brokers Limited',
    coverholderPin: '115933OFE',
    leadName: 'Beazley',
    startDate: new Date('2026-11-10T00:00:00.000Z'),
    endDate: new Date('2027-11-09T23:59:59.999Z'),
    classOfBusiness: 'PROPERTY',
    riskCode: 'HH',
    authorityClasses: [],
    territorialScope: ['CY', 'ES', 'PT', 'GR'],
    config: { productType: 'HOME', scope: { authorizedClass: 'Home', riskLocationCountries: ['CY', 'ES', 'PT', 'GR'] } },
  },
  {
    id: 'TRAVEL-24EEA6153',
    productCode: 'TRAVEL',
    agreementNumber: '24EEA6153',
    umr: 'B176024EEA6153',
    coverholderName: 'Abbeygate Insurance Brokers Limited',
    coverholderPin: '115933OFE',
    leadName: 'Brit Insurance',
    startDate: new Date('2024-11-15T00:00:00.000Z'),
    endDate: new Date('2025-11-14T23:59:59.999Z'),
    classOfBusiness: 'TRAVEL',
    riskCode: 'TE',
    authorityClasses: [],
    territorialScope: ['CY', 'ES', 'PT', 'GR'],
    config: { productType: 'TRAVEL', scope: { authorizedClass: 'Travel', riskLocationCountries: ['CY', 'ES', 'PT', 'GR'] } },
  },
  {
    id: 'TRAVEL-25EEA6153',
    productCode: 'TRAVEL',
    agreementNumber: '25EEA6153',
    umr: 'B176025EEA6153',
    coverholderName: 'Abbeygate Insurance Brokers Limited',
    coverholderPin: '115933OFE',
    leadName: 'Brit Insurance',
    startDate: new Date('2025-11-15T00:00:00.000Z'),
    endDate: new Date('2026-11-14T23:59:59.999Z'),
    classOfBusiness: 'TRAVEL',
    riskCode: 'TE',
    authorityClasses: [],
    territorialScope: ['CY', 'ES', 'PT', 'GR'],
    config: { productType: 'TRAVEL', scope: { authorizedClass: 'Travel', riskLocationCountries: ['CY', 'ES', 'PT', 'GR'] } },
  },
  {
    id: 'TRAVEL-26EEA6153',
    productCode: 'TRAVEL',
    agreementNumber: '26EEA6153',
    umr: 'B176026EEA6153',
    coverholderName: 'Abbeygate Insurance Brokers Limited',
    coverholderPin: '115933OFE',
    leadName: 'Brit Insurance',
    startDate: new Date('2026-11-15T00:00:00.000Z'),
    endDate: new Date('2027-11-14T23:59:59.999Z'),
    classOfBusiness: 'TRAVEL',
    riskCode: 'TE',
    authorityClasses: [],
    territorialScope: ['CY', 'ES', 'PT', 'GR'],
    config: { productType: 'TRAVEL', scope: { authorizedClass: 'Travel', riskLocationCountries: ['CY', 'ES', 'PT', 'GR'] } },
  },
  {
    id: 'BUSINESS-MANUAL-2026',
    productCode: 'BUSINESS',
    agreementNumber: 'BUSINESS-MANUAL-2026',
    umr: 'MANUAL BUSINESS 2026',
    coverholderName: 'Abbeygate Insurance Brokers Limited',
    coverholderPin: '115933OFE',
    leadName: 'Manual Market',
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-12-31T23:59:59.999Z'),
    classOfBusiness: 'COMMERCIAL',
    riskCode: 'COM',
    authorityClasses: ['PROPERTY', 'LIABILITY', 'BUSINESS_INTERRUPTION'],
    territorialScope: ['CY', 'GR'],
    config: { productType: 'BUSINESS', scope: { authorizedClass: 'Commercial', riskLocationCountries: ['CY', 'GR'] } },
  },
  {
    id: 'OPEN-MARKET-MANUAL-2026',
    productCode: 'OPEN_MARKET',
    agreementNumber: 'OPEN-MARKET-MANUAL-2026',
    umr: 'MANUAL OPEN MARKET 2026',
    coverholderName: 'Abbeygate Insurance Brokers Limited',
    coverholderPin: '115933OFE',
    leadName: 'Manual Market',
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: new Date('2026-12-31T23:59:59.999Z'),
    classOfBusiness: 'OPEN_MARKET',
    riskCode: 'OM',
    authorityClasses: ['MANUAL', 'COMMERCIAL'],
    territorialScope: ['CY', 'GR'],
    authorizedProductCodes: ['OPEN_MARKET', 'BUSINESS'],
    config: {
      productType: 'OPEN_MARKET',
      scope: {
        authorizedClass: 'Open Market',
        riskLocationCountries: ['CY', 'GR'],
        selectableProducts: ['BUSINESS'],
      },
    },
  },
];

export const CANONICAL_PRODUCT_CODES = Object.keys(CANONICAL_PROGRAMS) as CanonicalProductCode[];

export function canonicalBindersForProduct(productCode: CanonicalProductCode): CanonicalBinderSeed[] {
  return CANONICAL_BINDERS.filter((binder) => {
    if (binder.productCode === productCode) return true;
    return (binder.authorizedProductCodes || []).includes(productCode);
  });
}

export function statusForCanonicalPeriod(
  startDate: Date,
  endDate: Date,
  now: Date = new Date(),
): 'ACTIVE' | 'EXPIRED' | 'PENDING' {
  if (endDate.getTime() < now.getTime()) return 'EXPIRED';
  if (startDate.getTime() > now.getTime()) return 'PENDING';
  return 'ACTIVE';
}
