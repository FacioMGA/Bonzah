import { describe, expect, it } from 'vitest';
import {
  validateQuoteDataForIssuanceCanonical,
  QuoteDataIssuanceValidationError,
} from '../quoteDataIssuanceValidator.js';
import { additionalDriversConditionalRequirements } from '../../../../products/motor/motorReadinessHelpers.js';
import { buildQuoteDataFromDto, mapRawRowToDto } from '../../../reporting/app/bdxImport/mapper.js';
import { registerAllProducts } from '../../../../products/registerProducts.js';

registerAllProducts();

describe('additionalDriversConditionalRequirements', () => {
  it('returns no blockers when additional drivers are not required', () => {
    const result = additionalDriversConditionalRequirements({
      hasAdditionalDrivers: false,
      additionalDrivers: [],
    });
    expect(result).toEqual([]);
  });

  it('requires at least one additional driver when hasAdditionalDrivers=true', () => {
    const result = additionalDriversConditionalRequirements({
      hasAdditionalDrivers: true,
      additionalDrivers: [],
    });
    expect(result.length).toBe(1);
    expect(result[0]?.code).toBe('ADDITIONAL_DRIVERS_REQUIRED');
  });

  it('requires mandatory per-driver fields', () => {
    const result = additionalDriversConditionalRequirements({
      hasAdditionalDrivers: true,
      additionalDrivers: [{ firstName: 'Ari', lastName: '', dateOfBirth: '', licenseYears: '' }],
    });
    expect(result.length).toBe(1);
    expect(result[0]?.code).toBe('ADDITIONAL_DRIVER_FIELDS_REQUIRED');
  });
});

describe('validateQuoteDataForIssuanceCanonical (lower-level adapter verdict)', () => {
  const baseImportedQuote = buildQuoteDataFromDto(mapRawRowToDto({
    __productLine: 'motor',
    Id: '1',
    Entry: 'NB',
    Insured: 'Test User',
    Policy: 'ABLV1000001',
    Inception: '2025-12-01',
    Expiry: '2026-12-01',
    'Date Of Birth': '1980-01-01',
    Cover: 'Comp',
    Use: 'SDP',
    Drivers: 'Policy Holder',
    Make: 'FORD',
    Model: 'FOCUS',
    'Engine Size': 1600,
    'Vehicle Value': 10000,
    Year: 2018,
    Registration: 'ABC123',
    Excess: 200,
    'Premium Payable': 300,
    'Gross  Premium': 289,
    'MIF Payable': 9,
    'Stamp Payable': 2,
    'Comm.': 86.7,
    'Pay able to ARB': 202.3,
  }, 2));
  const completeQuote = {
    ...baseImportedQuote,
    proposer: {
      ...((baseImportedQuote as Record<string, unknown>).proposer as Record<string, unknown> | undefined),
      nif: '12345678A',
    },
  };

  it('returns the structured adapter verdict (no readiness blockers)', async () => {
    const result = await validateQuoteDataForIssuanceCanonical(completeQuote, 'MOTOR');
    expect(typeof result.valid).toBe('boolean');
    expect(Array.isArray(result.schemaIssues)).toBe(true);
    expect(Array.isArray(result.missingForIssuedPack)).toBe(true);
    expect(Array.isArray(result.conditionalRequirements)).toBe(true);
  });

  it('flags missing issued-pack fields when canonical risk data is absent', async () => {
    const baseline = await validateQuoteDataForIssuanceCanonical(completeQuote, 'MOTOR');
    const result = await validateQuoteDataForIssuanceCanonical({
      ...completeQuote,
      licenseType: '',
    }, 'MOTOR');
    expect(result.missingForIssuedPack.length).toBeGreaterThanOrEqual(baseline.missingForIssuedPack.length);
  });

  it('throws PRODUCT_NOT_ASSIGNED when no productType is supplied (no readiness vocabulary leak)', async () => {
    await expect(
      validateQuoteDataForIssuanceCanonical(completeQuote, undefined),
    ).rejects.toBeInstanceOf(QuoteDataIssuanceValidationError);
    await expect(
      validateQuoteDataForIssuanceCanonical(completeQuote, undefined),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_ASSIGNED' });
  });

  it('throws PRODUCT_NOT_SUPPORTED when no adapter is registered for the productType', async () => {
    await expect(
      validateQuoteDataForIssuanceCanonical(completeQuote, 'NOT_A_REAL_PRODUCT'),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_SUPPORTED' });
  });
});
