import { describe, expect, it } from 'vitest';
import { serializeMcpError, serializeMcpSuccess } from '../app/serializeMcpResult.js';
import { McpToolError } from '../domain/toolError.js';

describe('serializeMcpResult', () => {
    it('wraps success outputs with the canonical envelope shape', () => {
        const envelope = serializeMcpSuccess('config.products.listTemplates', { templates: [] });
        expect(envelope).toEqual({
            success: true,
            toolName: 'config.products.listTemplates',
            result: { templates: [] },
        });
    });

    it('preserves McpToolError code, message, suggestedFix, path, and ticket', () => {
        const err = new McpToolError({
            code: 'REQUIRES_ENGINEERING',
            message: 'No canonical MotorUwConfig threshold maps to field "fleetSize".',
            suggestedFix: 'Add fleetSize to MotorUwConfig before exposing it in Config MCP.',
            path: 'condition.field',
            ticket: {
                kind: 'new_factor',
                summary: 'Add MotorUwConfig threshold for fleetSize',
                canonicalOwner: 'backend/products/motor/underwriting/motorUwAutomation.ts',
            },
        });
        const envelope = serializeMcpError('config.underwriting.addReferralRule', err);
        expect(envelope.success).toBe(false);
        if (envelope.success) return; // narrow
        expect(envelope.toolName).toBe('config.underwriting.addReferralRule');
        expect(envelope.error.code).toBe('REQUIRES_ENGINEERING');
        expect(envelope.error.suggestedFix).toContain('Add fleetSize');
        expect(envelope.error.ticket?.canonicalOwner).toContain('motorUwAutomation');
    });

    it('maps non-McpToolError Errors to INTERNAL_ERROR', () => {
        const envelope = serializeMcpError('config.x.y', new Error('boom'));
        expect(envelope.success).toBe(false);
        if (envelope.success) return;
        expect(envelope.error.code).toBe('INTERNAL_ERROR');
    });

    it('maps unknown throwables to INTERNAL_ERROR', () => {
        const envelope = serializeMcpError('config.x.y', 'not-an-error');
        expect(envelope.success).toBe(false);
        if (envelope.success) return;
        expect(envelope.error.code).toBe('INTERNAL_ERROR');
    });
});
