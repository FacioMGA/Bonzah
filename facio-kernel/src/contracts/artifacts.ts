import { z } from 'zod';
import { operations } from './operations.js';
import { errorSchema } from './configuration.js';
import { catalog } from '../domain/catalog.js';
import { hash, KernelError } from '../domain/canonical.js';
import {
  controlOperations,
  principalSchema,
  accountSchema,
  tenantRecordSchema,
} from './control-plane.js';

type JsonSchema = z.core.JSONSchema.BaseSchema;
function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
const schemaCache = new WeakMap<z.ZodType, JsonSchema>();
export function jsonSchema(schema: z.ZodType): JsonSchema {
  const cached = schemaCache.get(schema);
  if (cached) return cached;
  const { $schema: _, ...result } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    reused: 'ref',
  });
  schemaCache.set(schema, immutable(result));
  return result;
}

/** MCP schemas are standalone resources. OpenAPI references must instead resolve from its document root. */
class OpenApiSchemas {
  readonly schemas: Record<string, JsonSchema> = {};
  private readonly roots = new WeakMap<z.ZodType, string>();
  add(schema: z.ZodType): JsonSchema {
    const cached = this.roots.get(schema);
    if (cached) return { $ref: '#/components/schemas/' + cached };
    const source = jsonSchema(schema),
      id = 'schema_' + hash(source);
    this.roots.set(schema, id);
    if (!this.schemas[id]) {
      const rewrite = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(rewrite);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(
          Object.entries(value).map(([key, child]) => {
            if (key !== '$ref') return [key, rewrite(child)];
            if (child === '#') return [key, '#/components/schemas/' + id];
            if (typeof child === 'string' && child.startsWith('#/$defs/'))
              return [key, '#/components/schemas/' + id + '_' + child.slice('#/$defs/'.length)];
            throw new Error('Unexpected non-local generated schema reference');
          }),
        );
      };
      const { $defs = {}, ...root } = source;
      this.schemas[id] = rewrite(root) as JsonSchema;
      for (const [name, definition] of Object.entries($defs))
        this.schemas[id + '_' + name] = rewrite(definition) as JsonSchema;
    }
    return { $ref: '#/components/schemas/' + id };
  }
  parameters(schema: z.ZodType) {
    this.add(schema);
    const root = this.schemas[this.roots.get(schema)!]!;
    return Object.entries(root.properties ?? {}).map(([name, property]) => ({
      name,
      in: 'query',
      required: root.required?.includes(name) ?? false,
      schema: property,
    }));
  }
}

function buildMcpDiscovery() {
  return {
    tools: Object.entries(operations)
      .filter(([, op]) => !('mcp' in op) || op.mcp !== false)
      .map(([name, op]) => ({
        name,
        description: op.summary,
        inputSchema: jsonSchema(op.input),
        // Every canonical result is an object, including discriminated object unions.
        outputSchema: { type: 'object' as const, ...jsonSchema(op.output) },
        annotations: {
          readOnlyHint: op.method === 'GET' || ('readOnly' in op && op.readOnly === true),
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      })),
  };
}
function buildOpenApi(registry: OpenApiSchemas) {
  const paths: Record<string, unknown> = {};
  for (const [name, op] of Object.entries(operations)) {
    const input = registry.add(op.input);
    const parameters = op.method === 'GET' ? registry.parameters(op.input) : [];
    paths[op.path] = {
      ...(paths[op.path] as Record<string, unknown> | undefined),
      [op.method.toLowerCase()]: {
        operationId: name,
        summary: op.summary,
        security: [{ bearerAuth: [] }],
        parameters,
        ...(op.method === 'PUT' || op.method === 'POST'
          ? { requestBody: { required: true, content: { 'application/json': { schema: input } } } }
          : {}),
        'x-permission': op.permission,
        responses: {
          '200': {
            description: 'Authorized result',
            content: { 'application/json': { schema: registry.add(op.output) } },
          },
          ...Object.fromEntries(
            [400, 401, 403, 404, 409, 413, 415, 422, 429, 500].map((status) => [
              status,
              {
                description:
                  (
                    {
                      401: 'Missing or invalid credential',
                      403: 'Permission denied',
                      409: 'Version or idempotency conflict',
                      422: 'Strict schema validation failed',
                      429: 'Rate limit exceeded',
                    } as Record<number, string>
                  )[status] ?? 'Request failed',
                content: { 'application/json': { schema: registry.add(errorSchema) } },
              },
            ]),
          ),
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Facio Kernel API',
      version: '0.1.0',
      description:
        'Scoped configuration and bounded sandbox insurance decisions, manual or configured quotes, independent review, servicing, renewal, synthetic documents, financial evidence and internal loss notices. Scope is derived from the credential. These capabilities do not establish customer acceptance, production insurance execution or external delivery.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      schemas: registry.schemas,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Server-issued credential bound to one workspace, tenant, environment, operating entity and actor. Local fixtures only in dev mode.',
        },
      },
    },
  };
}
let cachedMcp: ReturnType<typeof buildMcpDiscovery> | undefined;
let cachedOpenApi: ReturnType<typeof buildOpenApi> | undefined;
export function mcpDiscovery() {
  return (cachedMcp ??= immutable(buildMcpDiscovery()));
}
export function openApi() {
  return (cachedOpenApi ??= immutable(buildOpenApi(new OpenApiSchemas())));
}
const scopedCache = new Map<string, ReturnType<typeof buildMcpDiscovery>>();
export function scopedMcpDiscovery(permissions: readonly string[]) {
  const tools = mcpDiscovery().tools.filter((tool) =>
    permissions.includes(operations[tool.name as keyof typeof operations].permission),
  );
  const key = tools.map((tool) => tool.name).join(',');
  const cached = scopedCache.get(key);
  if (cached) return cached;
  const result = immutable({ tools });
  scopedCache.set(key, result);
  return result;
}
const hashCache = new WeakMap<object, string>();
function contractHash(value: object) {
  let result = hashCache.get(value);
  if (!result) {
    result = hash(value);
    hashCache.set(value, result);
  }
  return result;
}
export function contractManifest(
  permissions: readonly string[] = ['configuration:read', 'configuration:write', 'audit:read'],
) {
  return {
    version: '0.1.0',
    openapiHash: contractHash(openApi()),
    mcpHash: contractHash(scopedMcpDiscovery(permissions)),
    canonicalMcpHash: contractHash(mcpDiscovery()),
    catalogHash: contractHash(catalog),
    status: 'development' as const,
  };
}
export function verifyContractManifest(
  observed: { openapiHash: string; mcpHash: string; catalogHash: string },
  permissions?: readonly string[],
) {
  const expected = contractManifest(permissions);
  if (
    observed.openapiHash !== expected.openapiHash ||
    observed.mcpHash !== expected.mcpHash ||
    observed.catalogHash !== expected.catalogHash
  )
    throw new KernelError(
      'CONTRACT_DRIFT',
      'Observed contracts differ from this build; publication cannot be labeled current',
      409,
    );
}

/** Hosted discovery uses explicit resource selectors; all identities and memberships are resolved server-side. */
function buildHostedMcpDiscovery() {
  return {
    tools: [
      ...Object.entries(controlOperations)
        .filter(([, op]) => !('mcp' in op) || op.mcp !== false)
        .map(([name, op]) => ({ name, op, target: op.target })),
      ...Object.entries(operations)
        .filter(([, op]) => !('mcp' in op) || op.mcp !== false)
        .map(([name, op]) => ({ name, op, target: true })),
    ].map(({ name, op, target }) => ({
      name,
      description:
        op.summary +
        (target
          ? ' Supply the immutable tenantId returned by control_tenants; the server verifies current membership.'
          : ''),
      inputSchema: jsonSchema(target ? op.input.extend({ tenantId: z.string().uuid() }) : op.input),
      outputSchema: { type: 'object' as const, ...jsonSchema(op.output) },
      annotations: {
        readOnlyHint: op.method === 'GET' || ('readOnly' in op && op.readOnly === true),
        destructiveHint: name === 'control_activate' || name === 'control_rollback',
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['kernel:access'] }] },
    })),
  };
}

function buildHostedOpenApi() {
  const registry = new OpenApiSchemas();
  const base = buildOpenApi(registry);
  const paths = base.paths as Record<string, Record<string, Record<string, unknown>>>;
  const browserSession = [{ sessionCookie: [] }];
  const targetHeader = {
    name: 'X-Kernel-Tenant-Id',
    in: 'header',
    required: true,
    schema: { type: 'string', format: 'uuid' },
    description:
      'Immutable resource selector returned by control_tenants. Server resolves workspace, environment, operating entity and current membership from the database.',
  };
  const csrfHeader = {
    name: 'X-CSRF-Token',
    in: 'header',
    required: true,
    schema: { type: 'string' },
    description:
      'Required for every browser mutation. Use csrfToken from /api/session. OAuth bearer tokens are accepted only by the separate /mcp resource.',
  };
  for (const op of Object.values(operations)) {
    const entry = paths[op.path]![op.method.toLowerCase()]!;
    entry.security = browserSession;
    entry.parameters = [
      ...(entry.parameters as unknown[]),
      targetHeader,
      ...(op.method === 'GET' ? [] : [csrfHeader]),
    ];
    entry['x-authorization'] =
      'Fresh account and tenant membership plus the canonical operation permission; the resource selector cannot assert identity.';
  }
  for (const [name, op] of Object.entries(controlOperations)) {
    const entry = {
      operationId: name,
      summary: op.summary,
      security: browserSession,
      parameters: [
        ...(op.target ? [targetHeader] : []),
        ...(op.method === 'GET' ? [] : [csrfHeader]),
      ],
      ...(op.method === 'GET'
        ? {}
        : {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: registry.add(op.input) } },
            },
          }),
      'x-authorization':
        name === 'control_revoke_membership'
          ? 'Active account owner/admin membership.'
          : op.write
            ? 'Active owner/admin or authorized tenant builder membership.'
            : 'Active account and tenant membership.',
      responses: {
        '200': {
          description: 'Authorized result',
          content: { 'application/json': { schema: registry.add(op.output) } },
        },
        ...Object.fromEntries(
          [400, 401, 403, 404, 409, 413, 415, 422, 429, 500].map((status) => [
            status,
            {
              description: 'Request failed',
              content: { 'application/json': { schema: registry.add(errorSchema) } },
            },
          ]),
        ),
      },
    };
    paths[op.path] = { ...paths[op.path], [op.method.toLowerCase()]: entry };
  }
  paths['/api/session'] = {
    get: {
      operationId: 'hosted_session',
      summary:
        'Inspect current organization identity, account memberships and authorized tenant selectors',
      security: [{ sessionCookie: [] }],
      responses: {
        '200': {
          description: 'Current browser session',
          content: {
            'application/json': {
              schema: registry.add(
                z.strictObject({
                  principal: principalSchema,
                  accounts: z.array(accountSchema),
                  tenants: z.array(tenantRecordSchema),
                  csrfToken: z.string(),
                }),
              ),
            },
          },
        },
      },
    },
  };
  return {
    ...base,
    info: {
      title: 'Facio Kernel shared sandbox API',
      version: '0.2.0',
      description:
        'A shared sandbox with current account and tenant authorization, immutable configuration releases, configured insurance decisions, review, servicing and renewal. Registered synthetic document generation, financial evidence, provider simulation and internal loss notices remain bounded training capabilities. Activation does not certify customer acceptance, production insurance execution or external delivery.',
    },
    paths,
    components: {
      schemas: registry.schemas,
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Host-kernel_session',
          description:
            'Secure organization-authenticated browser session. Mutations also require the session CSRF token.',
        },
        kernelOAuth: {
          type: 'oauth2',
          description:
            'Delegated access for the /mcp resource only. Browser /api routes reject these bearer tokens; current account and tenant permissions are checked on every MCP request.',
          flows: {
            authorizationCode: {
              authorizationUrl: '/authorize',
              tokenUrl: '/token',
              scopes: {
                'kernel:access': 'Inspect and configure authorized Kernel sandbox tenants',
              },
            },
          },
        },
      },
    },
  };
}

let cachedHostedMcp: ReturnType<typeof buildHostedMcpDiscovery> | undefined;
let cachedHostedOpenApi: ReturnType<typeof buildHostedOpenApi> | undefined;
export function hostedMcpDiscovery() {
  return (cachedHostedMcp ??= immutable(buildHostedMcpDiscovery()));
}
export function hostedOpenApi() {
  return (cachedHostedOpenApi ??= immutable(buildHostedOpenApi()));
}
export function hostedContractManifest(buildSha?: string) {
  return {
    version: '0.2.0',
    openapiHash: contractHash(hostedOpenApi()),
    mcpHash: contractHash(hostedMcpDiscovery()),
    canonicalMcpHash: contractHash(hostedMcpDiscovery()),
    catalogHash: contractHash(catalog),
    status: 'hosted-sandbox' as const,
    ...(buildSha ? { buildSha } : {}),
  };
}
export function verifyHostedContractManifest(observed: {
  openapiHash: string;
  mcpHash: string;
  catalogHash: string;
}) {
  const expected = hostedContractManifest();
  if (
    observed.openapiHash !== expected.openapiHash ||
    observed.mcpHash !== expected.mcpHash ||
    observed.catalogHash !== expected.catalogHash
  )
    throw new KernelError(
      'CONTRACT_DRIFT',
      'Observed hosted contracts differ from this build',
      409,
    );
}
