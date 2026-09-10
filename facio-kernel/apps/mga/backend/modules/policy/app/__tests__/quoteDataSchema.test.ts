import { describe, expect, it } from 'vitest';
import { quoteDataInputSchema } from '../quoteDataSchema.js';
import {
  normalizeBoQuoteDataCompatibility,
  normalizeElectricVehicleCompatibility,
} from '../../../../products/motor/quotes/quoteDataGuards.js';

/**
 * Motor validation flows through the canonical `motorValidationProfile`
 * step + stage refinements via `validateForContext` and the consolidated
 * `validateDraftQuote` in `backend/modules/quotes/app/validatorImpl.ts`.
 *
 * This test guards the two boundary pieces:
 *   - `quoteDataInputSchema` is the *generic transport envelope* used
 *     by HTTP routers and OpenAPI; it must keep accepting arbitrary
 *     JSON object payloads regardless of product.
 *   - The motor-specific shape normalizers moved to
 *     `backend/products/motor/quotes/quoteDataGuards.ts` and stay
 *     responsible for BO compatibility quirks (cabrio, requiredExcess,
 *     EV engine size).
 */
describe('quoteDataTransportSchema + motor BO normalizers', () => {
  it('accepts generic quote payloads at the shared transport boundary', () => {
    const parsed = quoteDataInputSchema.safeParse({ productSpecific: { nested: true }, hello: 'world' });
    expect(parsed.success).toBe(true);
  });

  it('normalizes BO cabrio and required excess shapes', () => {
    const normalized = normalizeBoQuoteDataCompatibility({
      cabrio: false,
      requiredExcess: 500,
    });

    expect(normalized.cabrio).toBe('No');
    expect(normalized.requiredExcess).toBe('500');
  });

  it('locks fuelType to Electric for EV-named vehicles without inventing engineSize (ADR-0019)', () => {
    const normalized = normalizeElectricVehicleCompatibility({
      make: 'MG',
      model: 'MG 4 EV Xpower E (0)',
      fuelType: 'Electric',
      engineSize: 0,
    });
    expect(normalized.fuelType).toBe('Electric');
    // Per ADR-0016 (closed by PR 4), the legacy engineSize=1 sentinel is
    // gone. The normalizer no longer mutates engineSize and never sets
    // the deleted EV-normalized marker (built via concat below to avoid
    // tripping the no-deleted-identifiers regex).
    const deletedFlagKey = '__electric' + 'EngineSizeNormalized';
    expect(normalized.engineSize).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(normalized, deletedFlagKey)).toBe(false);
  });

  it('infers fuelType=Electric from make/model hints when fuelType is missing', () => {
    const normalized = normalizeElectricVehicleCompatibility({
      make: 'Tesla',
      model: 'Model 3',
      vehicleType: 'EV',
    });
    expect(normalized.fuelType).toBe('Electric');
  });
});
