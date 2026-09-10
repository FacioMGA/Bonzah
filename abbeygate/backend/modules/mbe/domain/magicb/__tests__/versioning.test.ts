
import { describe, it, expect } from 'vitest';
import { MagicB } from '../engine.js';
import { MagicBContext } from '../types.js';

describe('MagicB Versioning & Determinism', () => {
    const magicBInternal = MagicB as {
        validate: (context: MagicBContext, data: Record<string, unknown>, rules: unknown[]) => { valid: boolean; blockingErrors: Array<{ slug: string }> };
    };
    const context: MagicBContext = {
        tenantId: 't1',
        workflowStep: 'QUOTE'
    };

    const data = {
        fieldA: 'present'
    };

    // V1 Rules: fieldB is REQUIRED
    const rulesV1 = [
        {
            id: 'rule-v1',
            slug: 'fieldB',
            severity: 'BLOCK',
            contextFilter: {},
            ruleBody: { op: 'required' } as const
        }
    ];

    // V2 Rules: fieldB is NOT required (maybe deprecated)
    const rulesV2: unknown[] = [];

    it('validates against V1 rules (Classic Version)', () => {
        // We pass explicit rules to simulate "locking" to a specific version
        const result = magicBInternal.validate(context, data, rulesV1);

        expect(result.valid).toBe(false);
        expect(result.blockingErrors[0].slug).toBe('fieldB');
    });

    it('validates against V2 rules (Modern Version)', () => {
        const result = magicBInternal.validate(context, data, rulesV2);

        expect(result.valid).toBe(true);
    });
});
