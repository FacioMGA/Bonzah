import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { authorizeToolCall } from '../app/authorizeToolCall.js';
import type { McpContext } from '../domain/mcpContext.js';
import type { AnyToolDescriptor } from '../domain/toolDescriptor.js';
import { McpToolError } from '../domain/toolError.js';

function ctx(overrides: Partial<McpContext> = {}): McpContext {
    return {
        tenantId: 'tenant-A',
        userId: 'user-1',
        role: 'USER',
        permissions: ['configuration.read'],
        channel: 'web',
        sessionId: 'session-1',
        requestId: 'req-1',
        correlationId: 'cid-1',
        ...overrides,
    };
}

function tool(requiredPermission: string): AnyToolDescriptor {
    return {
        name: 'config.tests.echo',
        family: 'config',
        inputSchema: z.unknown(),
        outputSchema: z.unknown(),
        requiredPermission,
        description: 'test',
        auditClass: 'read',
        run: async (i) => i,
    };
}

describe('authorizeToolCall', () => {
    it('passes when caller has the required permission', () => {
        expect(() => authorizeToolCall(tool('configuration.read'), ctx())).not.toThrow();
    });

    it('throws UNAUTHORIZED when caller lacks the required permission', () => {
        let thrown: McpToolError | null = null;
        try {
            authorizeToolCall(tool('configuration.publish_sandbox'), ctx());
        } catch (e) {
            thrown = e as McpToolError;
        }
        expect(thrown?.code).toBe('UNAUTHORIZED');
        expect(thrown?.message).toMatch(/configuration\.publish_sandbox/);
    });

    it('throws UNAUTHORIZED when userId is absent', () => {
        let thrown: McpToolError | null = null;
        try {
            authorizeToolCall(tool('configuration.read'), ctx({ userId: '' }));
        } catch (e) {
            thrown = e as McpToolError;
        }
        expect(thrown?.code).toBe('UNAUTHORIZED');
    });
});
