
import { describe, it, expect } from 'vitest';
// import { MagicB } from '../engine.js';  // unused – conditionsMatch is tested directly
import { MagicBContext } from '../types.js';

// Expose private method for testing or assume validated behavior via public API
// To test 'isRuleApplicable' directly, we might need to export it or test via 'validate' with a dummy rule.
// For now, let's assume we can access it or we test via a public helper if we refactor.
// Actually, let's modify engine.ts to export the matcher for easier unit testing, 
// or simpler: test 'validate' with a mock registry. 
// Since Registry.getAllRules() is hardcoded or static, we might need to mock Registry.
// BUT, to keep it simple and clean, let's extract the matcher to a pure function 'conditionsMatch' 
// and test that function directly. I'll plan to refactor engine.ts to extract it.
// For this test file, I will assume the refactor happens.

import { conditionsMatch } from '../context-matcher.js';

describe('MagicB Context DSL', () => {
    const baseContext: MagicBContext = {
        tenantId: 't1',
        workflowStep: 'QUOTE',
        region: 'US',
        effectiveDate: new Date('2026-06-01')
    };

    it('matches simple equality', () => {
        expect(conditionsMatch({ region: 'US' }, baseContext)).toBe(true);
        expect(conditionsMatch({ region: 'UK' }, baseContext)).toBe(false);
    });

    it('matches date windowing (effective_from/to)', () => {
        // Effective 2026-06-01

        // Inside
        expect(conditionsMatch({ effective_from: '2026-01-01', effective_to: '2026-12-31' }, baseContext)).toBe(true);

        // Too early
        expect(conditionsMatch({ effective_from: '2026-07-01' }, baseContext)).toBe(false);

        // Too late
        expect(conditionsMatch({ effective_to: '2026-05-31' }, baseContext)).toBe(false);

        // Exact boundary (inclusive start)
        expect(conditionsMatch({ effective_from: '2026-06-01' }, baseContext)).toBe(true);
    });

    it('supports "all" (AND) logic', () => {
        const rule = {
            all: [
                { region: 'US' },
                { workflowStep: 'QUOTE' }
            ]
        };
        expect(conditionsMatch(rule, baseContext)).toBe(true);

        const failRule = {
            all: [
                { region: 'US' },
                { workflowStep: 'BIND' } // Mismatch
            ]
        };
        expect(conditionsMatch(failRule, baseContext)).toBe(false);
    });

    it('supports "any" (OR) logic', () => {
        const rule = {
            any: [
                { region: 'UK' }, // False
                { region: 'US' }  // True
            ]
        };
        expect(conditionsMatch(rule, baseContext)).toBe(true);

        const failRule = {
            any: [
                { region: 'UK' },
                { region: 'EU' }
            ]
        };
        expect(conditionsMatch(failRule, baseContext)).toBe(false);
    });

    it('supports "not" logic', () => {
        const rule = {
            not: { region: 'UK' }
        };
        expect(conditionsMatch(rule, baseContext)).toBe(true);

        const failRule = {
            not: { region: 'US' }
        };
        expect(conditionsMatch(failRule, baseContext)).toBe(false);
    });

    it('supports nested logic', () => {
        // (US AND (Quote OR Bind))
        const rule = {
            all: [
                { region: 'US' },
                {
                    any: [
                        { workflowStep: 'QUOTE' },
                        { workflowStep: 'BIND' }
                    ]
                }
            ]
        };
        expect(conditionsMatch(rule, baseContext)).toBe(true);
    });
});
