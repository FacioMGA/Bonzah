/**
 * Pins the OPERATOR_AGENT permission policy invariants from
 * ADR-0036 amendment #2 + ADR-0039 (V2): baseline includes
 * read/comm/analytics; mutation, policy completion, and document
 * retrieval are explicit per-key opt-ins. A regression here is the spec breaking; this test
 * fails loudly.
 */
import { describe, expect, it } from 'vitest';
import {
    OPERATOR_AGENT_BASELINE,
    OPERATOR_AGENT_OPTIONAL,
    PERMISSION_TAXONOMY,
} from '../../accessControl/domain/permissionTaxonomy.js';

describe('OPERATOR_AGENT permission policy (ADR-0036 amendment #2 + ADR-0039)', () => {
    it('baseline includes read / comm / analytics in fixed order', () => {
        expect(OPERATOR_AGENT_BASELINE).toEqual([
            'operator.read',
            'operator.comm',
            'operator.analytics',
        ]);
    });

    it('baseline never grants operator.mutate (must be explicit per-key opt-in)', () => {
        expect(OPERATOR_AGENT_BASELINE).not.toContain('operator.mutate');
    });

    it('policy completion capabilities remain explicit optional opt-ins', () => {
        expect(OPERATOR_AGENT_OPTIONAL).toEqual([
            'operator.mutate',
            'policies.bind',
            'documents.view',
        ]);
    });

    it('PERMISSION_TAXONOMY.Operator declares all four actions including mutate', () => {
        const operatorActions = (PERMISSION_TAXONOMY.Operator || []).map((p) => p.action);
        expect(operatorActions).toEqual(['read', 'comm', 'analytics', 'mutate']);
    });
});
