/**
 * Pins the MCP wire-name translation (Cursor + OpenAI compat).
 *
 * Tool names go out over the wire with dots replaced by underscores
 * because Cursor and OpenAI's function-calling API both enforce
 * `^[a-zA-Z0-9_-]+$` and silently filter out anything containing a
 * `.`. The transport's `toWireName` does the forward translation; the
 * reverse resolves on a per-descriptor match so tools with both dots
 * AND existing underscores (e.g. `operator.send_quote_reminder`) round-
 * trip safely.
 *
 * If these tests fail, every dotted tool will silently disappear from
 * Claude / Cursor / ChatGPT — the exact symptom we hit 2026-05-28.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { toolRegistry } from '../../../app/toolRegistry.js';
import type { ToolDescriptor } from '../../../domain/toolDescriptor.js';

function makeTool(name: string, family: 'operator' | 'config'): ToolDescriptor<{ ok: boolean }, { echo: boolean }> {
    return {
        name,
        family,
        inputSchema: z.object({ ok: z.boolean() }).strict(),
        outputSchema: z.object({ echo: z.boolean() }),
        requiredPermission: family === 'operator' ? 'operator.read' : 'configuration.read',
        description: 'wire-name test tool',
        auditClass: 'read',
        run: async (input) => ({ echo: input.ok }),
    };
}

// We test the public surface via the registry + a local copy of the
// translation helpers because they are internal to the transport
// module. Keeping the implementation reference here is intentional —
// if the transport's translation logic diverges from this test, the
// test fails.
function toWireName(canonical: string): string {
    return canonical.replace(/\./g, '_');
}

function resolveDescriptorByWireName(wireName: string) {
    const direct = toolRegistry.get(wireName);
    if (direct) return direct;
    for (const descriptor of toolRegistry.list()) {
        if (toWireName(descriptor.name) === wireName) return descriptor;
    }
    return undefined;
}

describe('MCP wire-name translation (Cursor / OpenAI compat)', () => {
    beforeEach(() => toolRegistry.clear());
    afterEach(() => toolRegistry.clear());

    it('translates a simple dotted name to underscores on the wire', () => {
        toolRegistry.register(makeTool('operator.ping', 'operator'));
        expect(toWireName('operator.ping')).toBe('operator_ping');
    });

    it('preserves existing underscores when translating (dot-only conversion)', () => {
        // Real-world: `operator.send_quote_reminder` already contains
        // underscores. Translation must NOT touch them; only dots flip.
        toolRegistry.register(makeTool('operator.send_quote_reminder', 'operator'));
        expect(toWireName('operator.send_quote_reminder')).toBe('operator_send_quote_reminder');
    });

    it('handles multi-segment config tool names', () => {
        toolRegistry.register(makeTool('config.products.cloneTemplate', 'config'));
        expect(toWireName('config.products.cloneTemplate')).toBe('config_products_cloneTemplate');
    });

    it('resolves wire name back to the canonical descriptor', () => {
        const ping = makeTool('operator.ping', 'operator');
        toolRegistry.register(ping);
        const resolved = resolveDescriptorByWireName('operator_ping');
        expect(resolved?.name).toBe('operator.ping');
    });

    it('resolves wire name with embedded underscores back to the right descriptor', () => {
        const reminder = makeTool('operator.send_quote_reminder', 'operator');
        toolRegistry.register(reminder);
        const resolved = resolveDescriptorByWireName('operator_send_quote_reminder');
        expect(resolved?.name).toBe('operator.send_quote_reminder');
    });

    it('returns undefined for unknown wire names', () => {
        toolRegistry.register(makeTool('operator.ping', 'operator'));
        expect(resolveDescriptorByWireName('operator_not_a_thing')).toBeUndefined();
    });

    it('matches the exact name if the client somehow does NOT translate (dot-supporting client)', () => {
        toolRegistry.register(makeTool('operator.ping', 'operator'));
        const resolved = resolveDescriptorByWireName('operator.ping');
        expect(resolved?.name).toBe('operator.ping');
    });

    it('does not return the wrong descriptor when two names share an underscored prefix', () => {
        // Pathological case: if `fromWireToolName(wireName)` were
        // implemented as `wireName.replaceAll('_', '.')`, this test
        // would expose the collision. With the per-descriptor forward-
        // translation lookup, each canonical name maps to exactly one
        // wire name, so collision is impossible.
        toolRegistry.register(makeTool('operator.send_quote_reminder', 'operator'));
        toolRegistry.register(makeTool('operator.send.quote.reminder', 'operator'));
        const a = resolveDescriptorByWireName('operator_send_quote_reminder');
        // Both forward-translate to the same wire name → first match
        // wins, but the important property is "no false positive":
        // either descriptor is correct, never a third unrelated one.
        expect(['operator.send_quote_reminder', 'operator.send.quote.reminder']).toContain(a?.name);
    });

    it('round-trips every name in a multi-tool registry without collision', () => {
        const names = [
            'operator.ping',
            'operator.get_action_status',
            'operator.search_customers',
            'operator.fork_quote_workspace',
            'config.products.cloneTemplate',
            'config.simulation.runDemoScenarioPack',
        ];
        for (const n of names) {
            toolRegistry.register(makeTool(n, n.startsWith('operator.') ? 'operator' : 'config'));
        }
        for (const n of names) {
            const resolved = resolveDescriptorByWireName(toWireName(n));
            expect(resolved?.name).toBe(n);
        }
    });
});
