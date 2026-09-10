import { describe, expect, it } from 'vitest';
import { translateReferralRule } from '../domain/referralRuleMapping.js';
import { McpToolError } from '../../mcp/domain/toolError.js';

describe('translateReferralRule', () => {
    it('maps numeric high-severity vehicle value to declineVehicleValueOver', () => {
        const result = translateReferralRule({
            ruleKey: 'declineVehicleValueOver',
            name: 'Decline above €100k',
            condition: { field: 'vehicleValue', operator: 'gt', value: 100000 },
            severity: 'high',
            reason: 'Classic car cap',
            appliesAt: ['quote', 'bind'],
        });
        expect(result.targetKey).toBe('declineVehicleValueOver');
        expect(result.patch.thresholds?.declineVehicleValueOver).toBe(100000);
    });

    it('maps numeric medium-severity vehicle value to referralVehicleValueOver', () => {
        const result = translateReferralRule({
            ruleKey: 'referralVehicleValueOver',
            name: 'Refer above €80k',
            condition: { field: 'vehicleValue', operator: 'gt', value: 80000 },
            severity: 'medium',
            reason: 'Higher review threshold',
            appliesAt: ['quote'],
        });
        expect(result.targetKey).toBe('referralVehicleValueOver');
        expect(result.patch.thresholds?.referralVehicleValueOver).toBe(80000);
    });

    it('maps list-in operator vehicleUse to allowedVehicleUses', () => {
        const result = translateReferralRule({
            ruleKey: 'allowedVehicleUses',
            name: 'Restrict to weekend',
            condition: { field: 'vehicleUse', operator: 'in', value: ['Occasional', 'Weekend'] },
            severity: 'medium',
            reason: 'Classic car restriction',
            appliesAt: ['quote', 'bind'],
        });
        expect(result.targetKey).toBe('allowedVehicleUses');
        expect(result.patch.allowedVehicleUses).toEqual(['Occasional', 'Weekend']);
    });

    it('maps fuelType Electric to the electric-vehicle referral flag', () => {
        const result = translateReferralRule({
            ruleKey: 'referElectricVehicles',
            name: 'Refer electric vehicles',
            condition: { field: 'fuelType', operator: 'eq', value: 'Electric' },
            severity: 'medium',
            reason: 'EV directive',
            appliesAt: ['quote'],
        });
        expect(result.targetKey).toBe('referralFlags.referElectricVehicles');
        expect(result.patch.referralFlags?.referElectricVehicles).toBe(true);
    });

    it('maps vehicleType Motorhome to the motorcaravan referral flag', () => {
        const result = translateReferralRule({
            ruleKey: 'referMotorhomes',
            name: 'Refer motorhomes',
            condition: { field: 'vehicleType', operator: 'eq', value: 'Motorhome' },
            severity: 'medium',
            reason: 'Motorhome directive',
            appliesAt: ['quote'],
        });
        expect(result.targetKey).toBe('referralFlags.referMotorcaravan');
        expect(result.patch.referralFlags?.referMotorcaravan).toBe(true);
    });

    it('returns REQUIRES_ENGINEERING for unknown fields', () => {
        let thrown: McpToolError | null = null;
        try {
            translateReferralRule({
                ruleKey: 'fleetSizeOver',
                name: 'Fleet size cap',
                condition: { field: 'fleetSize', operator: 'gt', value: 20 },
                severity: 'high',
                reason: 'Commercial cap',
                appliesAt: ['quote'],
            });
        } catch (e) {
            thrown = e as McpToolError;
        }
        expect(thrown?.code).toBe('REQUIRES_ENGINEERING');
        expect(thrown?.ticket?.kind).toBe('new_factor');
    });

    it('rejects malformed list-in payloads', () => {
        let thrown: McpToolError | null = null;
        try {
            translateReferralRule({
                ruleKey: 'allowedVehicleUses',
                name: 'Bad',
                condition: { field: 'vehicleUse', operator: 'in', value: 42 },
                severity: 'medium',
                reason: '',
                appliesAt: ['quote'],
            });
        } catch (e) {
            thrown = e as McpToolError;
        }
        expect(thrown?.code).toBe('VALIDATION_ERROR');
    });
});
