import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { authenticateApiKey } from '../../middleware/apiKeyAuth.js';
import programsRouter from './programs.js';
import quotesRouter from './quotes.js';
import policiesRouter from './policies.js';
import claimsRouter from './claims.js';
import webhooksRouter from './webhooks.js';
import { createMcpJsonRpcRouter } from '../../../modules/mcp/http/mcpJsonRpcRouter.js';
import { apiReference } from '@scalar/express-api-reference';
import { generateOpenApiDocument } from '../../docs/openapi.js';
import { setAccountScopeContext } from '../../middleware/rls.js';

const v1Router = Router();
const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

// 1. Serve Swagger JSON and Redocly UI (No API Key Required to read docs)
let openApiDoc: unknown;
v1Router.get('/docs/swagger.json', (_req, res) => {
    if (!openApiDoc) openApiDoc = generateOpenApiDocument();
    res.json(openApiDoc);
});

const scalarDocsOptions = {
    theme: 'kepler',
    layout: 'modern',
    spec: {
        url: '/api/v1/docs/swagger.json'
    },
    metaData: {
        title: 'Facio Public API Reference',
    },
    authentication: {
        preferredSecurityScheme: 'ApiKeyAuth'
    }
};

const scalarDocsHandler = apiReference(scalarDocsOptions as Parameters<typeof apiReference>[0]);

// Scalar emits two `<script>` tags: a remote bundle on jsdelivr and a small
// inline bootstrap. The global Helmet CSP (backend/index.ts) blocks both, so
// the docs page is blank in production. Trade-off: keep the global posture
// intact (security contract SD-002) and scope a relaxed CSP to /api/v1/docs
// only — allowlisting jsdelivr and the *exact* inline-script hash, never
// `'unsafe-inline'`. The hash is derived from a one-shot pre-render below.
const renderedScalarDocsHtml = ((): string => {
    type CaptureRes = { type: () => CaptureRes; send: (body: unknown) => CaptureRes };
    try {
        let captured = '';
        const captureRes: CaptureRes = {
            type: () => captureRes,
            send: (body: unknown) => { captured = String(body ?? ''); return captureRes; },
        };
        // Scalar's handler only touches `res.type().send(...)` so we pass a minimal
        // stub. Cast at the call site (not the literal) to satisfy `consistent-type-assertions`.
        const fakeReq = {};
        scalarDocsHandler(fakeReq as never, captureRes as never);
        return captured;
    } catch {
        return '';
    }
})();

const inlineScriptMatch = renderedScalarDocsHtml.match(
    /<script type="text\/javascript">([\s\S]*?)<\/script>/,
);
const inlineScriptSha256 = inlineScriptMatch
    ? crypto.createHash('sha256').update(inlineScriptMatch[1]).digest('base64')
    : null;
// Fall back to `'unsafe-inline'` only if Scalar's HTML shape changes so the
// hash extraction misses — better than serving a broken page. The fallback is
// still route-scoped to /api/v1/docs.
const inlineScriptSource = inlineScriptSha256
    ? `'sha256-${inlineScriptSha256}'`
    : "'unsafe-inline'";

const scalarDocsCsp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    `script-src 'self' ${inlineScriptSource} https://cdn.jsdelivr.net`,
    `script-src-elem 'self' ${inlineScriptSource} https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "style-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://cdn.jsdelivr.net",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "connect-src 'self' https://cdn.jsdelivr.net",
    "worker-src 'self' blob:",
    "form-action 'self'",
].join('; ');

const applyScalarDocsCsp: RequestHandler = (_req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Content-Security-Policy-Report-Only');
    res.setHeader(
        IS_PROD ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
        scalarDocsCsp,
    );
    next();
};

v1Router.use('/docs', applyScalarDocsCsp, scalarDocsHandler);

// 2a. MCP remote agent surfaces (ADR-0036 amendments). Both mounts
// carry their own MCP-specific API key middleware (mcpApiKeyAuth) that
// synthesises a CONFIG_AGENT or OPERATOR_AGENT identity from the key's
// `permissions` array, so they MUST mount BEFORE the blanket
// `authenticateApiKey` middleware below. setAccountScopeContext is
// skipped: MCP tools do not need an Account-scoped RLS GUC; the
// operating-tenant ALS context is already set by
// `resolveOperatingTenant` upstream. Each family resolves its own
// `tools/list` filter inside the Streamable HTTP transport.
v1Router.use('/mcp/config', createMcpJsonRpcRouter({ family: 'config' }));
v1Router.use('/mcp/operator', createMcpJsonRpcRouter({ family: 'operator' }));

// 2b. Global Public API Authentication for everything else under /api/v1.
v1Router.use(authenticateApiKey);
v1Router.use(setAccountScopeContext);

// 3. Protected v1 Routes
v1Router.use('/programs', programsRouter);
v1Router.use('/quotes', quotesRouter);
v1Router.use('/policies', policiesRouter);
v1Router.use('/claims', claimsRouter);
v1Router.use('/webhooks', webhooksRouter);

export default v1Router;
