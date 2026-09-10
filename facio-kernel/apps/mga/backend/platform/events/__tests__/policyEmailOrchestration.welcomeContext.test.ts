/**
 * ABY-77 — Regression tests for the welcome-email subject summary +
 * date formatter helpers.
 *
 * Background: the canonical `NEW_BUSINESS_CONFIRMATION` template
 * (`backend/modules/communications/domain/customerTemplateCatalog.ts`)
 * marks `policy.startDate`, `policy.endDate` and `policy.vehicleDescription`
 * as REQUIRED. The shared template renderer
 * (`backend/modules/communications/domain/templateRenderer.ts:67-70`)
 * treats `''` as a missing required variable and the dispatch service
 * (`backend/modules/communications/app/customerEmailTriggerService.ts:34-39`)
 * silently skips delivery when any required variable is missing.
 *
 * These tests pin down the per-product summary contract so the
 * regression cannot return.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPolicySubjectLabel,
  buildPolicySubjectSummary,
  formatPolicyDateForEmail,
} from '../policyEmailOrchestration.js';

describe('buildPolicySubjectSummary — product-aware welcome email subject', () => {
  describe('motor', () => {
    it('uses Policy.vehicleInfo as the canonical source', () => {
      const out = buildPolicySubjectSummary({
        policyNumber: 'CY-MO-123',
        productType: 'MOTOR',
        quoteData: {},
        vehicleInfo: { make: 'Toyota', model: 'Yaris', registrationNumber: 'KAB1234' },
      });
      expect(out).toBe('Toyota Yaris (KAB1234)');
    });

    it('falls back to canonical quoteData.make/model/registrationNumber when vehicleInfo is empty', () => {
      const out = buildPolicySubjectSummary({
        policyNumber: 'CY-MO-456',
        productType: 'MOTOR',
        quoteData: { make: 'Honda', model: 'Civic', registrationNumber: 'KAB5678' },
        vehicleInfo: {},
      });
      expect(out).toBe('Honda Civic (KAB5678)');
    });

    it('does not read obsolete vehicleMake/vehicleModel keys', () => {
      const out = buildPolicySubjectSummary({
        policyNumber: 'CY-MO-789',
        productType: 'MOTOR',
        quoteData: { vehicleMake: 'BMW', vehicleModel: '320i', vehicleRegistration: 'KAB0001' },
        vehicleInfo: {},
      });
      expect(out).toBe('Policy CY-MO-789');
    });

    it('falls back to the policy number when vehicle is entirely unknown', () => {
      const out = buildPolicySubjectSummary({
        policyNumber: 'CY-MO-NONE',
        productType: 'MOTOR',
        quoteData: {},
        vehicleInfo: {},
      });
      expect(out).toBe('Policy CY-MO-NONE');
    });

    it('does not treat unset productType as motor', () => {
      const out = buildPolicySubjectSummary({
        policyNumber: 'CY-LEG-1',
        productType: null,
        quoteData: { make: 'Ford', model: 'Focus' },
        vehicleInfo: {},
      });
      expect(out).toBe('Policy CY-LEG-1');
    });
  });

  describe('home', () => {
    it('uses property.address.line1 + city when present', () => {
      const out = buildPolicySubjectSummary({
        policyNumber: 'CY-HO-1',
        productType: 'HOME',
        quoteData: { property: { address: { line1: '12 Olive Grove', city: 'Limassol' } } },
        vehicleInfo: null,
      });
      expect(out).toBe('12 Olive Grove, Limassol');
    });

    it('falls back to property type when address is missing (no redundant suffix)', () => {
      const out = buildPolicySubjectSummary({
        policyNumber: 'CY-HO-2',
        productType: 'HOME',
        quoteData: { property: { propertyType: 'Apartment' } },
        vehicleInfo: null,
      });
      expect(out).toBe('Apartment');
    });

    it('falls back to the policy number when nothing is known', () => {
      const out = buildPolicySubjectSummary({
        policyNumber: 'CY-HO-3',
        productType: 'HOME',
        quoteData: {},
        vehicleInfo: null,
      });
      expect(out).toBe('Policy CY-HO-3');
    });
  });

  describe('travel', () => {
    it('humanizes the canonical planType token + destinations', () => {
      const out = buildPolicySubjectSummary({
        policyNumber: 'CY-TR-1',
        productType: 'TRAVEL',
        quoteData: { trip: { planType: 'single_trip', destinations: ['Greece', 'Italy'] } },
        vehicleInfo: null,
      });
      expect(out).toBe('Single Trip to Greece, Italy');
    });

    it('humanizes annual_multi_trip and compresses long destination lists', () => {
      const out = buildPolicySubjectSummary({
        policyNumber: 'CY-TR-2',
        productType: 'TRAVEL',
        quoteData: { trip: { planType: 'annual_multi_trip', destinations: ['UK', 'FR', 'DE', 'IT', 'ES'] } },
        vehicleInfo: null,
      });
      expect(out).toBe('Annual Multi-Trip to UK, FR, DE +2 more');
    });

    it('falls back to the policy number when there are no destinations', () => {
      const out = buildPolicySubjectSummary({
        policyNumber: 'CY-TR-3',
        productType: 'TRAVEL',
        quoteData: { trip: {} },
        vehicleInfo: null,
      });
      expect(out).toBe('Policy CY-TR-3');
    });
  });

  describe('safety net', () => {
    it('never returns an empty string (the renderer would treat it as a missing required var)', () => {
      const summaries = [
        buildPolicySubjectSummary({ policyNumber: '', productType: 'MOTOR', quoteData: {}, vehicleInfo: {} }),
        buildPolicySubjectSummary({ policyNumber: '', productType: 'HOME', quoteData: {}, vehicleInfo: {} }),
        buildPolicySubjectSummary({ policyNumber: '', productType: 'TRAVEL', quoteData: {}, vehicleInfo: {} }),
        buildPolicySubjectSummary({ policyNumber: '', productType: 'UNKNOWN', quoteData: {}, vehicleInfo: {} }),
      ];
      for (const s of summaries) {
        expect(s.trim().length).toBeGreaterThan(0);
      }
    });
  });
});

describe('buildPolicySubjectLabel — product-aware cover noun', () => {
  it('returns the correct noun per product', () => {
    expect(buildPolicySubjectLabel('MOTOR')).toBe('Vehicle');
    expect(buildPolicySubjectLabel('motor')).toBe('Vehicle');
    expect(buildPolicySubjectLabel('TRAVEL')).toBe('Trip');
    expect(buildPolicySubjectLabel('HOME')).toBe('Property');
    expect(buildPolicySubjectLabel('HEALTH')).toBe('Plan');
  });

  it('falls back to a neutral "Cover" for unknown or missing product types', () => {
    expect(buildPolicySubjectLabel('BUSINESS')).toBe('Cover');
    expect(buildPolicySubjectLabel(null)).toBe('Cover');
    expect(buildPolicySubjectLabel(undefined)).toBe('Cover');
  });
});

describe('formatPolicyDateForEmail — canonical Policy column formatter', () => {
  it('formats a real Date to en-GB long form', () => {
    expect(formatPolicyDateForEmail(new Date('2026-05-08T00:00:00.000Z'))).toMatch(/\d+\s+\w+\s+\d{4}/);
  });

  it('returns empty string for null/undefined', () => {
    expect(formatPolicyDateForEmail(null)).toBe('');
    expect(formatPolicyDateForEmail(undefined)).toBe('');
  });

  it('returns empty string for an invalid Date', () => {
    expect(formatPolicyDateForEmail(new Date('not a date'))).toBe('');
  });
});
