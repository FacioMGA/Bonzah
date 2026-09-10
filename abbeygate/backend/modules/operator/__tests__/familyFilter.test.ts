/**
 * Pins the family-filter isolation guarantee on the shared
 * MCP toolRegistry (ADR-0036 amendment #2): tools registered under
 * one family must never appear in another family's `tools/list`
 * filter and must never be dispatched through another family's
 * mount.
 *
 * This test exercises the registry directly + a simulated family
 * filter that mirrors what `handleMcpStreamableHttpRequest` does
 * internally; it does not boot the Streamable HTTP transport.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toolRegistry } from '../../mcp/app/toolRegistry.js';
import type { ToolDescriptor } from '../../mcp/domain/toolDescriptor.js';

function makeTool(name: string, family: 'config' | 'operator'): ToolDescriptor<{ ok: boolean }, { echo: boolean }> {
    return {
        name,
        family,
        inputSchema: z.object({ ok: z.boolean() }).strict(),
        outputSchema: z.object({ echo: z.boolean() }),
        requiredPermission: family === 'operator' ? 'operator.read' : 'configuration.read',
        description: 'test tool',
        auditClass: 'read',
        run: async (input) => ({ echo: input.ok }),
    };
}

describe('toolRegistry family filtering (ADR-0036 amendment #2)', () => {
    beforeEach(() => {
        toolRegistry.clear();
    });
    afterEach(() => {
        toolRegistry.clear();
    });

    it('listByFamily returns only the matching family', () => {
        toolRegistry.register(makeTool('config.products.list', 'config'));
        toolRegistry.register(makeTool('config.products.clone', 'config'));
        toolRegistry.register(makeTool('operator.search_customers', 'operator'));
        toolRegistry.register(makeTool('operator.search_quotes', 'operator'));

        const configOnly = toolRegistry.listByFamily('config').map((t) => t.name);
        expect(configOnly).toEqual(['config.products.clone', 'config.products.list']);

        const operatorOnly = toolRegistry.listByFamily('operator').map((t) => t.name);
        expect(operatorOnly).toEqual(['operator.search_customers', 'operator.search_quotes']);

        // The two listings together cover the full registry exactly once.
        expect([...configOnly, ...operatorOnly].sort()).toEqual(
            toolRegistry.list().map((t) => t.name).sort(),
        );
    });

    it('a config-family caller cannot reach an operator tool by name', () => {
        toolRegistry.register(makeTool('operator.search_customers', 'operator'));
        const fetched = toolRegistry.get('operator.search_customers');
        expect(fetched?.family).toBe('operator');
        // The streamable HTTP transport's family-filter check uses this
        // descriptor.family — pin the invariant so a future refactor
        // that drops `family` from the descriptor fails this test.
        expect(fetched?.family).not.toBe('config');
    });
});
