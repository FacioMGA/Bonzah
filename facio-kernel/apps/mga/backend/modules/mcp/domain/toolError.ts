/**
 * Closed union of MCP tool error codes (ADR-0036 §4).
 *
 * Every failure from a tool MUST map to one of these codes. The transport
 * adapter then serialises this into its protocol envelope (JSON-REST for
 * HTTP today, MCP JSON-RPC if a stdio adapter lands later).
 *
 * `REQUIRES_ENGINEERING` is the V1 escape hatch: any tool call that
 * would require a code change (new questionnaire field, new pricing
 * factor, new document template, new product line) returns this code
 * with a structured ticket payload instead of silently no-op-ing.
 */
export type McpToolErrorCode =
    | 'UNAUTHORIZED'
    | 'VALIDATION_ERROR'
    | 'DRAFT_NOT_FOUND'
    | 'UNKNOWN_FIELD_REFERENCE'
    | 'DUPLICATE_KEY'
    | 'INVALID_OVERRIDE'
    | 'PUBLISH_BLOCKED'
    | 'REQUIRES_ENGINEERING'
    | 'INTERNAL_ERROR';

export interface McpToolErrorDetails {
    code: McpToolErrorCode;
    message: string;
    suggestedFix?: string;
    path?: string;
    /** Optional ticket payload returned with REQUIRES_ENGINEERING. */
    ticket?: {
        kind: 'new_question' | 'new_factor' | 'new_template' | 'new_product' | 'other';
        summary: string;
        canonicalOwner: string;
    };
}

export class McpToolError extends Error {
    public readonly code: McpToolErrorCode;
    public readonly suggestedFix?: string;
    public readonly path?: string;
    public readonly ticket?: McpToolErrorDetails['ticket'];

    constructor(details: McpToolErrorDetails) {
        super(details.message);
        this.name = 'McpToolError';
        this.code = details.code;
        this.suggestedFix = details.suggestedFix;
        this.path = details.path;
        this.ticket = details.ticket;
    }

    toJSON(): McpToolErrorDetails {
        return {
            code: this.code,
            message: this.message,
            suggestedFix: this.suggestedFix,
            path: this.path,
            ticket: this.ticket,
        };
    }
}
