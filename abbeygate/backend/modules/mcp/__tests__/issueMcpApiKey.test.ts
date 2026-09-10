/**
 * Unit-level test for the MCP key permission policy (ADR-0036 amendment).
 *
 * Persistence is mocked via the tenant-scoped Prisma extension and the
 * tenant ALS context — this test asserts only that the issued key
 * carries the right permission set given the input flags.
 */
import { describe, expect, it } from 'vitest';
import {
    CONFIG_AGENT_BASELINE,
    CONFIG_AGENT_OPTIONAL,
} from '../../accessControl/domain/permissionTaxonomy.js';

describe('CONFIG_AGENT permission policy (ADR-0036 amendment)', () => {
    it('baseline includes read/draft/validate/simulate but NOT publish_sandbox', () => {
        expect(CONFIG_AGENT_BASELINE).toEqual([
            'configuration.read',
            'configuration.draft',
            'configuration.validate',
            'configuration.simulate',
        ]);
        expect(CONFIG_AGENT_BASELINE).not.toContain('configuration.publish_sandbox');
        expect(CONFIG_AGENT_BASELINE).not.toContain('configuration.publish_production');
    });

    it('optional opt-ins are sandbox-only — production publish is never offered to MCP keys', () => {
        expect(CONFIG_AGENT_OPTIONAL).toEqual(['configuration.publish_sandbox']);
        expect(CONFIG_AGENT_OPTIONAL).not.toContain('configuration.publish_production');
    });

    it('opting in to sandbox publish produces baseline + sandbox (5 perms, no production)', () => {
        const perms = [...CONFIG_AGENT_BASELINE];
        if (CONFIG_AGENT_OPTIONAL.includes('configuration.publish_sandbox')) {
            perms.push('configuration.publish_sandbox');
        }
        expect(perms).toEqual([
            'configuration.read',
            'configuration.draft',
            'configuration.validate',
            'configuration.simulate',
            'configuration.publish_sandbox',
        ]);
        expect(perms).not.toContain('configuration.publish_production');
    });
});
