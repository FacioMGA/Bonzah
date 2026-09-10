import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { Principal } from '../contracts/control-plane.js';
import { controlOperations, type ControlOperationName } from '../contracts/control-plane.js';
import { operations, type OperationName } from '../contracts/operations.js';
import { hostedMcpDiscovery } from '../contracts/artifacts.js';
import type { Kernel } from '../application/kernel.js';
import { KernelError } from '../domain/canonical.js';

export { hostedMcpDiscovery };
export async function handleHostedMcp(
  kernel: Kernel,
  principal: Principal,
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
) {
  const server = new Server(
    { name: 'facio-kernel', version: '0.2.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    kernel.control.session(principal);
    return hostedMcpDiscovery();
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    try {
      const raw = { ...(request.params.arguments ?? {}) };
      const hasTarget = Object.hasOwn(raw, 'tenantId');
      const target = hasTarget ? z.string().uuid().parse(raw.tenantId) : undefined;
      delete raw.tenantId;
      let result: unknown;
      if (Object.hasOwn(controlOperations, name)) {
        const op = controlOperations[name as ControlOperationName];
        if ('mcp' in op && op.mcp === false)
          throw new KernelError(
            'TRANSPORT_NOT_ALLOWED',
            'Use the authorized operator application to manage access',
            403,
          );
        if (!op.target && hasTarget)
          throw new KernelError(
            'INVALID_TARGET',
            'This control operation does not take a tenantId',
            422,
          );
        result = kernel.control.execute(name as ControlOperationName, raw, principal, target);
      } else if (Object.hasOwn(operations, name)) {
        const op = operations[name as OperationName];
        if ('mcp' in op && op.mcp === false)
          throw new KernelError(
            'TRANSPORT_NOT_ALLOWED',
            'Use the authorized operator application for insurance transactions',
            403,
          );
        if (!target)
          throw new KernelError(
            'TENANT_REQUIRED',
            'Supply an explicit tenantId from control_tenants',
            400,
          );
        result = kernel.executeForPrincipal(name as OperationName, raw, principal, target);
      } else throw new KernelError('NOT_FOUND', 'The requested capability is not implemented', 404);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (error) {
      const value = {
        error: {
          code:
            error instanceof KernelError
              ? error.code
              : error instanceof z.ZodError
                ? 'VALIDATION_ERROR'
                : 'INTERNAL_ERROR',
          message:
            error instanceof KernelError
              ? error.message
              : error instanceof z.ZodError
                ? 'Tool arguments do not satisfy the published schema'
                : 'The operation failed',
          correlationId: principal.correlationId,
        },
      };
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
    }
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
