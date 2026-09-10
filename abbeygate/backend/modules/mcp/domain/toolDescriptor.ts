import type { ZodType } from 'zod';
import type { McpContext } from './mcpContext.js';

/**
 * Normative shape for every MCP tool registered with the canonical
 * registry (ADR-0036). The registry rejects descriptors whose schemas
 * use `z.any()`, `z.unknown()`, `.passthrough()`, or `.catchall(...)`
 * via `tools/quality/check-mcp-tool-schema-quality.mjs` — the same
 * schema-honesty posture as ADR-0028 enforces for `typedHandler`.
 *
 * Tools register from their owning module's `app/*.tool.ts` files,
 * never directly from this module — `mcp/` publishes; modules own.
 */
export interface ToolDescriptor<TInput, TOutput> {
    /** Dot-namespaced tool name, e.g. 'config.products.cloneTemplate'. */
    name: string;
    /** Tool family — e.g. 'config'. Used for catalog grouping and rate-limit. */
    family: string;
    /** Strict Zod schema for tool input. MUST NOT accept reserved context fields. */
    inputSchema: ZodType<TInput>;
    /** Strict Zod schema for tool output. */
    outputSchema: ZodType<TOutput>;
    /** Required fine-grained permission key, e.g. 'configuration.draft'. */
    requiredPermission: string;
    /** Short, model-facing description surfaced in the MCP tool catalog. */
    description: string;
    /**
     * One of the audit/event actor categories — drives outbox aggregateType
     * and the `check-operator-mutation-preview-required.mjs` guard.
     *
     *  - `read`                : pure read; no writes.
     *  - `draft` / `validate` / `simulate`  : Config MCP staging-only writes.
     *  - `publish`             : Config MCP canonical mutation.
     *  - `comm`                : Operator MCP V1 customer communication.
     *  - `mutate-staging`      : Operator MCP V2 internal workspace write
     *    that the operator can reverse with a subsequent tool call (fork,
     *    patch, rate, save-version). Does NOT require a confirmation token
     *    because no customer-visible side effect has occurred yet.
     *  - `mutate`              : Operator MCP V2 commit step that reaches
     *    a customer or downstream system (send revised quote, submit
     *    endorsement for review). MUST be the second leg of a
     *    preview-then-confirm pair (ADR-0039): either returns OR consumes
     *    a `confirmation_token`. Pinned by the preview-required guard.
     */
    auditClass:
        | 'read'
        | 'draft'
        | 'validate'
        | 'simulate'
        | 'publish'
        | 'comm'
        | 'mutate-staging'
        | 'mutate';
    /** Tool implementation. Runs after authorize + inputSchema.parse. */
    run: (input: TInput, ctx: McpContext) => Promise<TOutput>;
}

// Helper: erase the input/output generics for storage in the registry map
// while preserving runtime validation through the schemas.
export type AnyToolDescriptor = ToolDescriptor<unknown, unknown>;

/**
 * Type guard used by the registry to assert that a descriptor's name
 * follows the dot-namespaced family convention. Segments are
 * lowerCamelCase or snake_case (matches the spec's tool catalog —
 * e.g. `config.products.cloneTemplate` and `config.products.list_templates`
 * are both well-formed).
 */
export function isWellFormedToolName(name: string, family: string): boolean {
    if (!name || !family) return false;
    if (!name.startsWith(`${family}.`)) return false;
    const segments = name.split('.');
    if (segments.length < 2) return false;
    return segments.every((s) => /^[a-z][a-zA-Z0-9_]*$/.test(s));
}
