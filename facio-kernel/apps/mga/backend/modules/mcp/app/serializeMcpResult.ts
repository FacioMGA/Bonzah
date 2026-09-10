import type { McpToolErrorDetails } from '../domain/toolError.js';
import { McpToolError } from '../domain/toolError.js';

/**
 * Default serialisation envelope used by the HTTP/SSE transport
 * (ADR-0036). Plain REST JSON today; a future stdio transport
 * would substitute its own envelope without changing the registry.
 */
export interface McpSuccessEnvelope<T = unknown> {
    success: true;
    toolName: string;
    result: T;
}

export interface McpErrorEnvelope {
    success: false;
    toolName: string;
    error: McpToolErrorDetails;
}

export function serializeMcpSuccess<T>(toolName: string, result: T): McpSuccessEnvelope<T> {
    return { success: true, toolName, result };
}

export function serializeMcpError(toolName: string, error: unknown): McpErrorEnvelope {
    if (error instanceof McpToolError) {
        return { success: false, toolName, error: error.toJSON() };
    }
    if (error instanceof Error) {
        return {
            success: false,
            toolName,
            error: {
                code: 'INTERNAL_ERROR',
                message: process.env.NODE_ENV === 'production'
                    ? 'Internal error executing tool.'
                    : error.message,
            },
        };
    }
    return {
        success: false,
        toolName,
        error: { code: 'INTERNAL_ERROR', message: 'Unknown error executing tool.' },
    };
}
