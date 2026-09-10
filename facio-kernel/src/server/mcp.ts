import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '../contracts/configuration.js';
import { operations, type OperationName } from '../contracts/operations.js';
import { Kernel } from '../application/kernel.js';
import { KernelError } from '../domain/canonical.js';
import { scopedMcpDiscovery } from '../contracts/artifacts.js';

export async function handleMcp(
  kernel: Kernel,
  context: Context,
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
) {
  // Low-level SDK dispatch keeps strict parsing/denials inside the audited command funnel.
  // The convenience McpServer validates arguments first and can bypass domain audit on denial.
  const server = new Server(
    { name: 'facio-kernel', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    kernel.store.audit(context, 'mcp:tools/list', 'succeeded');
    return scopedMcpDiscovery(context.permissions);
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    try {
      if (!Object.hasOwn(operations, name)) {
        kernel.store.audit(context, 'mcp:unknown-tool', 'NOT_FOUND');
        throw new KernelError('NOT_FOUND', 'The tool is not implemented', 404);
      }
      const operation = operations[name as OperationName];
      if ('mcp' in operation && operation.mcp === false) {
        kernel.store.audit(context, name, 'TRANSPORT_NOT_ALLOWED');
        throw new KernelError(
          'TRANSPORT_NOT_ALLOWED',
          'Insurance mutations are unavailable through MCP; use the authorized operator workflow',
          403,
        );
      }
      const result = kernel.execute(
        name as OperationName,
        request.params.arguments ?? {},
        context,
      ) as Record<string, unknown>;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      const value = {
        error: {
          code: error instanceof KernelError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof KernelError ? error.message : 'Operation failed',
          correlationId: context.correlationId,
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
