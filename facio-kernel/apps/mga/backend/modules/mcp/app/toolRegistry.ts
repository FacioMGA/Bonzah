import {
    isWellFormedToolName,
    type AnyToolDescriptor,
    type ToolDescriptor,
} from '../domain/toolDescriptor.js';
import type { ToolCatalogSnapshot } from '../domain/transport.js';

/**
 * Canonical MCP tool registry (ADR-0036). Single instance per process.
 * Tools register from their owning module's `app/*.tool.ts` files —
 * `mcp/` only publishes them.
 *
 * Schema-honesty + reserved-context-field bans are enforced by
 * `tools/quality/check-mcp-tool-schema-quality.mjs`, not by this
 * runtime, because static analysis catches misuse at lint time.
 */
class ToolRegistry implements ToolCatalogSnapshot {
    private readonly tools = new Map<string, AnyToolDescriptor>();

    register<I, O>(descriptor: ToolDescriptor<I, O>): void {
        if (!isWellFormedToolName(descriptor.name, descriptor.family)) {
            throw new Error(
                `[mcp.toolRegistry] Malformed tool name "${descriptor.name}" for family "${descriptor.family}". ` +
                    `Tool names must be dot-namespaced under their family (e.g. "${descriptor.family}.products.cloneTemplate") ` +
                    `with lowercase + underscore segments.`,
            );
        }
        if (this.tools.has(descriptor.name)) {
            throw new Error(
                `[mcp.toolRegistry] Duplicate tool registration: "${descriptor.name}". ` +
                    `Each tool name is single-source per process.`,
            );
        }
        this.tools.set(descriptor.name, descriptor as AnyToolDescriptor);
    }

    get(name: string): AnyToolDescriptor | undefined {
        return this.tools.get(name);
    }

    list(): AnyToolDescriptor[] {
        return Array.from(this.tools.values()).sort((a, b) => a.name.localeCompare(b.name));
    }

    listByFamily(family: string): AnyToolDescriptor[] {
        return this.list().filter((t) => t.family === family);
    }

    /** Test-only: clear the registry between tests. */
    clear(): void {
        this.tools.clear();
    }

    size(): number {
        return this.tools.size;
    }
}

export const toolRegistry = new ToolRegistry();
