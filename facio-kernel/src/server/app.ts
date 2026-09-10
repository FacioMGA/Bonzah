import { initializeRustMoney } from '../domain/rust-money.js';
import Fastify from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Kernel } from '../application/kernel.js';
import { operations, type OperationName } from '../contracts/operations.js';
import {
  contractManifest,
  scopedMcpDiscovery,
  openApi,
  hostedOpenApi,
  hostedContractManifest,
} from '../contracts/artifacts.js';
import { KernelError } from '../domain/canonical.js';
import { Authenticator, type Credential } from './auth.js';
import { handleMcp } from './mcp.js';
import type { Context } from '../contracts/configuration.js';
import {
  controlOperations,
  type ControlOperationName,
  type Principal,
} from '../contracts/control-plane.js';
import { HostedAuth } from './hosted-auth.js';
import { hostedRoutes } from './hosted-routes.js';
import { providerRoutes, providerWorker } from './provider-routes.js';
import { documentWorker } from './document-worker.js';
import fastifyExpress from '@fastify/express';
import { ZodError } from 'zod';
import { handleHostedMcp, hostedMcpDiscovery } from './hosted-mcp.js';
declare module 'fastify' {
  interface FastifyRequest {
    kernelContext: Context;
    kernelPrincipal: Principal;
  }
}

export function buildApp(options: {
  kernel: Kernel;
  credentials?: Credential[];
  hosted?: { auth: HostedAuth; publicUrl: string; buildSha: string; region: string };
  publicDir?: string;
  maxRequestsPerMinute?: number;
  providerWorker?: boolean;
  documentWorker?: boolean;
}) {
  const moneyEngine = initializeRustMoney();
  const app = Fastify({
    logger: false,
    bodyLimit: 256 * 1024,
    requestTimeout: 30_000,
    trustProxy: false,
  });
  const auth = options.hosted ? undefined : new Authenticator(options.credentials ?? []);
  const windows = new Map<string, { start: number; count: number }>();
  app.decorateRequest('kernelContext');
  app.decorateRequest('kernelPrincipal');
  app.addHook('onRequest', async (request, reply) => {
    reply.headers({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    const host = request.headers.host;
    if (!host) throw new KernelError('INVALID_HOST', 'Host header is required', 400);
    let hostname: string;
    try {
      hostname = new URL('http://' + host).hostname;
    } catch {
      throw new KernelError('INVALID_HOST', 'Host header is invalid', 400);
    }
    if (
      options.hosted
        ? host !== new URL(options.hosted.publicUrl).host
        : !['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    )
      throw new KernelError(
        'INVALID_HOST',
        'The request host is not configured for this deployment',
        403,
      );
    const path = request.url.split('?')[0]!;
    if (options.hosted && path.startsWith('/auth/')) {
      const key = 'auth:' + request.ip,
        now = Date.now();
      let window = windows.get(key);
      if (!window || now - window.start >= 60_000) {
        window = { start: now, count: 0 };
        windows.set(key, window);
      }
      if (++window.count > 120)
        throw new KernelError('RATE_LIMITED', 'Too many sign-in requests; retry in a minute', 429);
    }
    const oauthProtocol =
      ['/token', '/register', '/revoke'].includes(path) || path.startsWith('/.well-known/');
    const expectedOrigin = options.hosted
      ? new URL(options.hosted.publicUrl).origin
      : 'http://' + host;
    if (
      request.headers.origin &&
      request.headers.origin !== expectedOrigin &&
      !(options.hosted && oauthProtocol)
    )
      throw new KernelError('INVALID_ORIGIN', 'Cross-origin requests are disabled', 403);
    if (path.startsWith('/api/') || path === '/mcp') {
      if (path === '/api/auth/config') return;
      let key: string;
      if (options.hosted) {
        if (path === '/mcp')
          request.kernelPrincipal = options.hosted.auth.authenticate(request.headers.authorization);
        else {
          const session = options.hosted.auth.session(request.headers.cookie);
          if (!session)
            throw new KernelError(
              'UNAUTHENTICATED',
              'Sign in to the operator application; MCP access tokens are not valid for browser API routes',
              401,
            );
          request.kernelPrincipal = session.principal;
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method))
            options.hosted.auth.verifyCsrf(session, request.headers['x-csrf-token']);
        }
        key = request.kernelPrincipal.actorId;
      } else {
        request.kernelContext = auth!.authenticate(request.headers.authorization);
        key = createHash('sha256').update(request.headers.authorization!).digest('hex');
      }
      const now = Date.now();
      let window = windows.get(key);
      if (!window || now - window.start >= 60_000) {
        window = { start: now, count: 0 };
        windows.set(key, window);
      }
      if (++window.count > (options.maxRequestsPerMinute ?? 120)) {
        if (request.kernelContext)
          options.kernel.store.audit(request.kernelContext, 'transport', 'RATE_LIMITED');
        else
          options.kernel.store.control.audit(request.kernelPrincipal, 'transport', 'RATE_LIMITED');
        reply.header('retry-after', '60');
        throw new KernelError(
          'RATE_LIMITED',
          'Credential request limit exceeded; retry in one minute',
          429,
        );
      }
    }
  });
  if (options.hosted) {
    app.register(fastifyExpress);
    app.after(() => {
      app.use(options.hosted!.auth.router());
    });
    hostedRoutes(app, options.hosted.auth, options.kernel);
  }
  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status =
      error instanceof KernelError
        ? error.status
        : error instanceof ZodError
          ? 422
          : typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500
            ? statusCode
            : 500;
    reply.code(status).send({
      error: {
        code:
          error instanceof KernelError
            ? error.code
            : status < 500
              ? 'INVALID_REQUEST'
              : 'INTERNAL_ERROR',
        message:
          error instanceof KernelError
            ? error.message
            : status < 500
              ? 'The request could not be parsed'
              : 'The operation failed',
        correlationId:
          request.kernelContext?.correlationId ??
          request.kernelPrincipal?.correlationId ??
          randomUUID(),
      },
    });
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (options.hosted && reply.statusCode === 401 && request.url.split('?')[0] === '/mcp')
      reply.header(
        'www-authenticate',
        `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', options.hosted.publicUrl).href}"`,
      );
    if (options.hosted) reply.header('x-kernel-build', options.hosted.buildSha);
    return payload;
  });
  const tenantId = (request: { headers: Record<string, unknown> }) => {
    const value = request.headers['x-kernel-tenant-id'];
    if (typeof value !== 'string')
      throw new KernelError('TENANT_REQUIRED', 'Select an explicit tenant for this operation', 400);
    return value;
  };
  for (const [name, operation] of Object.entries(operations)) {
    app.route({
      method: operation.method,
      url: operation.path,
      handler: async (request, reply) => {
        reply.header(
          'x-correlation-id',
          request.kernelContext?.correlationId ?? request.kernelPrincipal.correlationId,
        );
        const input = operation.method === 'GET' ? request.query : request.body;
        if (options.hosted)
          return options.kernel.executeForPrincipal(
            name as OperationName,
            input,
            request.kernelPrincipal,
            tenantId(request),
          );
        return options.kernel.execute(name as OperationName, input, request.kernelContext);
      },
    });
  }
  if (options.hosted)
    for (const [name, operation] of Object.entries(controlOperations))
      app.route({
        method: operation.method,
        url: operation.path,
        handler: async (request, reply) => {
          reply.header('x-correlation-id', request.kernelPrincipal.correlationId);
          return options.kernel.control.execute(
            name as ControlOperationName,
            operation.method === 'GET' ? request.query : request.body,
            request.kernelPrincipal,
            operation.target ? tenantId(request) : undefined,
          );
        },
      });
  const readContracts = (context: Context) => {
    if (!context.permissions.includes('configuration:read'))
      throw new KernelError('FORBIDDEN', 'Configuration read permission is required', 403);
  };
  app.get('/api/openapi.json', async (request) => {
    if (options.hosted) return hostedOpenApi();
    readContracts(request.kernelContext);
    return openApi();
  });
  app.get('/api/mcp-discovery', async (request) => {
    if (options.hosted) return hostedMcpDiscovery();
    readContracts(request.kernelContext);
    options.kernel.store.audit(request.kernelContext, 'contracts:mcp-discovery', 'succeeded');
    return scopedMcpDiscovery(request.kernelContext.permissions);
  });
  app.get('/api/manifest', async (request) => {
    if (options.hosted) return hostedContractManifest(options.hosted.buildSha);
    readContracts(request.kernelContext);
    return contractManifest(request.kernelContext.permissions);
  });
  app.post('/mcp', async (request, reply) => {
    // Responses are owned by the SDK; authentication and origin/rate controls run above.
    reply.hijack();
    for (const [key, value] of Object.entries(reply.getHeaders()))
      if (value !== undefined) reply.raw.setHeader(key, value);
    if (options.hosted)
      await handleHostedMcp(
        options.kernel,
        request.kernelPrincipal,
        request.raw,
        reply.raw,
        request.body,
      );
    else
      await handleMcp(options.kernel, request.kernelContext, request.raw, reply.raw, request.body);
  });
  app.get('/api/auth/config', async () =>
    options.hosted
      ? {
          mode: 'hosted-sandbox',
          loginUrl: '/auth/login',
          buildSha: options.hosted.buildSha,
          region: options.hosted.region,
          providers: options.hosted.auth.providers(),
        }
      : { mode: 'development' },
  );
  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    mode: options.hosted ? 'hosted-sandbox' : 'local-development',
    ...(options.hosted
      ? {
          environment: 'sandbox',
          buildSha: options.hosted.buildSha,
          region: options.hosted.region,
          storage: 'sqlite-single-writer-managed-disk',
        }
      : {}),
    moneyEngine,
    productionReady: false,
  }));
  providerRoutes(app, options.kernel);
  if (options.providerWorker) providerWorker(app, options.kernel);
  if (options.documentWorker) documentWorker(app, options.kernel);
  const publicDir = options.publicDir ?? resolve('public');
  for (const [route, file, type] of [
    ['/insurance-fnol.js', 'insurance-fnol.js', 'text/javascript'],
    ['/insurance-fnol.css', 'insurance-fnol.css', 'text/css'],
    ['/insurance-documents.js', 'insurance-documents.js', 'text/javascript'],
    ['/insurance-documents.css', 'insurance-documents.css', 'text/css'],
    ['/insurance-report.js', 'insurance-report.js', 'text/javascript'],
    ['/insurance-finance.js', 'insurance-finance.js', 'text/javascript'],
    ['/insurance-finance.css', 'insurance-finance.css', 'text/css'],
    ['/insurance-operations.js', 'insurance-operations.js', 'text/javascript'],
    ['/', 'index.html', 'text/html'],
    ['/studio', 'index.html', 'text/html'],
    ['/app.js', 'app.js', 'text/javascript'],
    ['/styles.css', 'styles.css', 'text/css'],
    ['/insurance-config.js', 'insurance-config.js', 'text/javascript'],
    ['/insurance-config.css', 'insurance-config.css', 'text/css'],
    ['/insurance-decision.js', 'insurance-decision.js', 'text/javascript'],
    ['/insurance-decision.css', 'insurance-decision.css', 'text/css'],
    ['/insurance-approval.js', 'insurance-approval.js', 'text/javascript'],
    ['/insurance-approval.css', 'insurance-approval.css', 'text/css'],
    ['/insurance-provider.js', 'insurance-provider.js', 'text/javascript'],
    ['/insurance-provider.css', 'insurance-provider.css', 'text/css'],
    ['/insurance-workflow.js', 'insurance-workflow.js', 'text/javascript'],
  ]) {
    app.get(route!, async (_request, reply) =>
      reply.type(type!).send(await readFile(resolve(publicDir, file!))),
    );
  }
  return app;
}
