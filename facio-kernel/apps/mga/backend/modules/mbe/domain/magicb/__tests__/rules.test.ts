
import { describe, it, expect } from 'vitest';
import { executeRule } from '../rules/index.js';
import { MagicBContext } from '../types.js';

describe('MagicB Rule Interpreter', () => {
    const baseContext: MagicBContext = {
        tenantId: 't1',
        workflowStep: 'QUOTE'
    };

    it('validates "required"', () => {
        const op = { op: 'required' } as const;
        expect(executeRule('foo', op, baseContext)).toBe(true);
        expect(executeRule(0, op, baseContext)).toBe(true);
        expect(executeRule('', op, baseContext)).toBe(false);
        expect(executeRule(null, op, baseContext)).toBe(false);
        expect(executeRule(undefined, op, baseContext)).toBe(false);
    });

    it('validates "required" with "if" condition (met)', () => {
        // Required IF country == US
        const op = {
            op: 'required',
            if: { contextAxis: 'region', op: 'eq', value: 'US' }
        } as const;

        const contextUS = { ...baseContext, region: 'US' };

        // Condition met -> Rule applies -> Missing value -> Fail
        expect(executeRule('', op, contextUS)).toBe(false);

        // Condition met -> Rule applies -> Present value -> Pass
        expect(executeRule('val', op, contextUS)).toBe(true);
    });

    it('validates "required" with "if" condition (not met)', () => {
        // Required IF country == US
        const op = {
            op: 'required',
            if: { contextAxis: 'region', op: 'eq', value: 'US' }
        } as const;

        const contextUK = { ...baseContext, region: 'UK' };

        // Condition NOT met -> Rule does NOT apply -> Missing value -> Pass (not required)
        expect(executeRule('', op, contextUK)).toBe(true);
    });

    it('validates "gt" / "lt"', () => {
        expect(executeRule(10, { op: 'gt', value: 5 }, baseContext)).toBe(true);
        expect(executeRule(5, { op: 'gt', value: 5 }, baseContext)).toBe(false);

        expect(executeRule(4, { op: 'lt', value: 5 }, baseContext)).toBe(true);
        expect(executeRule(5, { op: 'lt', value: 5 }, baseContext)).toBe(false);
    });

    it('validates "one_of" (enum)', () => {
        const op = { op: 'one_of', values: ['A', 'B'] };
        expect(executeRule('A', op, baseContext)).toBe(true);
        expect(executeRule('C', op, baseContext)).toBe(false);
    });

    it('validates "regex"', () => {
        const op = { op: 'regex', pattern: '^[A-Z]{3}$' };
        expect(executeRule('ABC', op, baseContext)).toBe(true);
        expect(executeRule('abc', op, baseContext)).toBe(false);
        expect(executeRule('ABCD', op, baseContext)).toBe(false);
    });

    // New types from Test Plan
    it('validates "date_parse" (is valid date)', () => {
        const op = { op: 'date_parse' };
        expect(executeRule('2026-01-01', op, baseContext)).toBe(true);
        expect(executeRule(new Date(), op, baseContext)).toBe(true);
        expect(executeRule('not-a-date', op, baseContext)).toBe(false);
    });
});
