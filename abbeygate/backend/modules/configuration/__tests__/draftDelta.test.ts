import { describe, expect, it } from 'vitest';
import { DraftDeltaSchema, mergeDraftDelta, type DraftDelta } from '../domain/draftDelta.js';

describe('DraftDeltaSchema', () => {
    it('accepts an empty delta', () => {
        expect(() => DraftDeltaSchema.parse({})).not.toThrow();
    });

    it('rejects unknown top-level slots (strict)', () => {
        expect(() => DraftDeltaSchema.parse({ unknownSlot: {} })).toThrow();
    });

    it('round-trips a fully populated delta', () => {
        const delta: DraftDelta = {
            uwOverrides: {
                allowedVehicleUses: ['Occasional', 'Weekend'],
                referralFlags: { referElectricVehicles: true },
                thresholds: { declineVehicleValueOver: 100000 },
            },
            jurisdictionOverrides: {
                documentConfig: [
                    { documentType: 'certificate', requiredAt: ['bind'], issuanceTrigger: 'on_bind' },
                ],
            },
            billing: {
                currency: 'EUR',
                paymentTerms: 'pay_before_bind',
                commissionPercent: 12.5,
                cancellationRefundBasis: 'pro_rata',
                nonRefundableFees: ['adminFee'],
            },
        };
        const parsed = DraftDeltaSchema.parse(delta);
        expect(parsed).toEqual(delta);
    });
});

describe('mergeDraftDelta', () => {
    it('merges UW thresholds additively (later wins on collision)', () => {
        const a: DraftDelta = {
            uwOverrides: { thresholds: { declineVehicleValueOver: 200000 } },
        };
        const b: DraftDelta = {
            uwOverrides: { thresholds: { declineVehicleValueOver: 100000, referralVehicleValueOver: 50000 } },
        };
        const merged = mergeDraftDelta(a, b);
        expect(merged.uwOverrides?.thresholds).toEqual({
            declineVehicleValueOver: 100000,
            referralVehicleValueOver: 50000,
        });
    });

    it('replaces array fields wholesale (allowed* lists)', () => {
        const a: DraftDelta = { uwOverrides: { allowedRiskCountries: ['Cyprus', 'Portugal'] } };
        const b: DraftDelta = { uwOverrides: { allowedRiskCountries: ['Cyprus'] } };
        const merged = mergeDraftDelta(a, b);
        expect(merged.uwOverrides?.allowedRiskCountries).toEqual(['Cyprus']);
    });

    it('merges UW referral flags additively (later wins on collision)', () => {
        const a: DraftDelta = {
            uwOverrides: { referralFlags: { referElectricVehicles: true, referMotorcycle: true } },
        };
        const b: DraftDelta = {
            uwOverrides: { referralFlags: { referElectricVehicles: false, referHybridVehicles: true } },
        };
        const merged = mergeDraftDelta(a, b);
        expect(merged.uwOverrides?.referralFlags).toEqual({
            referElectricVehicles: false,
            referMotorcycle: true,
            referHybridVehicles: true,
        });
    });

    it('dedupes approval rules by (workflow, ruleKey) — later wins', () => {
        const a: DraftDelta = {
            approvalRules: [
                {
                    workflow: 'quote_referral',
                    ruleKey: 'high-value',
                    name: 'High value',
                    condition: { field: 'vehicleValue', operator: 'gt', value: 50000 },
                    requiredRole: 'UNDERWRITER',
                },
            ],
        };
        const b: DraftDelta = {
            approvalRules: [
                {
                    workflow: 'quote_referral',
                    ruleKey: 'high-value',
                    name: 'High value (tightened)',
                    condition: { field: 'vehicleValue', operator: 'gt', value: 100000 },
                    requiredRole: 'ADMIN',
                },
            ],
        };
        const merged = mergeDraftDelta(a, b);
        expect(merged.approvalRules).toHaveLength(1);
        expect(merged.approvalRules?.[0].name).toBe('High value (tightened)');
        expect(merged.approvalRules?.[0].requiredRole).toBe('ADMIN');
    });

    it('merges jurisdictionOverrides.documentConfig by documentType', () => {
        const a: DraftDelta = {
            jurisdictionOverrides: {
                documentConfig: [
                    { documentType: 'certificate', requiredAt: ['bind'], issuanceTrigger: 'on_bind' },
                ],
            },
        };
        const b: DraftDelta = {
            jurisdictionOverrides: {
                documentConfig: [
                    { documentType: 'green_card', issuanceTrigger: 'on_request', requiredAt: [] },
                ],
            },
        };
        const merged = mergeDraftDelta(a, b);
        expect(merged.jurisdictionOverrides?.documentConfig?.map((d) => d.documentType)).toEqual([
            'certificate',
            'green_card',
        ]);
    });
});
