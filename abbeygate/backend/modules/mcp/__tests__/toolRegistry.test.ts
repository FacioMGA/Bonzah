/**
 * Unit tests for the canonical MCP ToolRegistry (ADR-0036). The
 * registry is the single source of truth for "AI agent tool exposure"
 * — these tests pin the four observable behaviours that downstream
 * transport adapters depend on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toolRegistry } from '../app/toolRegistry.js';
import type { ToolDescriptor } from '../domain/toolDescriptor.js';
import { isWellFormedToolName } from '../domain/toolDescriptor.js';

function buildTool(name: string, family = 'config'): ToolDescriptor<{ ok: boolean }, { echo: boolean }> {
    return {
        name,
        family,
        inputSchema: z.object({ ok: z.boolean() }).strict(),
        outputSchema: z.object({ echo: z.boolean() }),
        requiredPermission: 'configuration.read',
        description: 'test tool',
        auditClass: 'read',
        run: async (input) => ({ echo: input.ok }),
    };
}

describe('toolRegistry', () => {
    afterEach(() => {
        toolRegistry.clear();
    });

    it('registers and looks up tools by name', () => {
        toolRegistry.register(buildTool('config.tests.echo'));
        const tool = toolRegistry.get('config.tests.echo');
        expect(tool?.name).toBe('config.tests.echo');
        expect(toolRegistry.size()).toBe(1);
    });

    it('rejects duplicate tool names', () => {
        toolRegistry.register(buildTool('config.tests.echo'));
        expect(() => toolRegistry.register(buildTool('config.tests.echo'))).toThrow(/Duplicate tool registration/);
    });

    it('rejects malformed tool names', () => {
        expect(() => toolRegistry.register(buildTool('CONFIG.BAD'))).toThrow(/Malformed tool name/);
        expect(() => toolRegistry.register(buildTool('config.bad-name'))).toThrow(/Malformed tool name/);
        expect(() => toolRegistry.register(buildTool('other.bad', 'config'))).toThrow(/Malformed tool name/);
    });

    it('lists tools sorted by name and filters by family', () => {
        toolRegistry.register(buildTool('config.a.x'));
        toolRegistry.register(buildTool('config.b.x'));
        toolRegistry.register(buildTool('quotes.a.x', 'quotes'));
        const all = toolRegistry.list().map((t) => t.name);
        expect(all).toEqual(['config.a.x', 'config.b.x', 'quotes.a.x']);
        const configOnly = toolRegistry.listByFamily('config').map((t) => t.name);
        expect(configOnly).toEqual(['config.a.x', 'config.b.x']);
    });
});

describe('isWellFormedToolName', () => {
    it('accepts dot-namespaced lowerCamelCase or snake_case segments', () => {
        expect(isWellFormedToolName('config.products.cloneTemplate', 'config')).toBe(true);
        expect(isWellFormedToolName('config.products.clone_template', 'config')).toBe(true);
        expect(isWellFormedToolName('config.products.list_templates', 'config')).toBe(true);
    });

    it('rejects mismatched families and bad shapes', () => {
        expect(isWellFormedToolName('config.x', 'quotes')).toBe(false);
        expect(isWellFormedToolName('singleword', 'singleword')).toBe(false);
        expect(isWellFormedToolName('Config.x.y', 'Config')).toBe(false);
        expect(isWellFormedToolName('config.x-y.z', 'config')).toBe(false);
    });
});
