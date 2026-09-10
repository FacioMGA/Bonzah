import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import SwaggerParser from '@apidevtools/swagger-parser';
import {
  jsonSchema,
  openApi,
  hostedOpenApi,
  mcpDiscovery,
  hostedMcpDiscovery,
  scopedMcpDiscovery,
  contractManifest,
  hostedContractManifest,
} from '../src/contracts/artifacts.js';
import { operations } from '../src/contracts/operations.js';
import { controlOperations } from '../src/contracts/control-plane.js';
import { permissions } from '../src/contracts/configuration.js';
import { hash } from '../src/domain/canonical.js';
import { buildApp } from '../src/server/app.js';
import { setupConfiguredV2 } from './fixtures/configured-v2.js';
import { multiRiskSubmission } from './fixtures/insurance-v2.js';
import { syntheticFnolDetails, fnolFixture } from './fixtures/fnol.js';

const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
function pointer(root: unknown, ref: string): unknown {
  assert.ok(ref === '#' || ref.startsWith('#/'), 'No external schema dependencies');
  return ref === '#'
    ? root
    : ref
        .slice(2)
        .split('/')
        .reduce((node: unknown, key) => {
          const name = decodeURIComponent(key).replace(/~1/g, '/').replace(/~0/g, '~');
          assert.ok(
            node && typeof node === 'object' && Object.hasOwn(node, name),
            `Unresolved ${ref}`,
          );
          return (node as Record<string, unknown>)[name];
        }, root);
}
function checkRefs(value: unknown, root = value, openApiDocument = false): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref') {
      assert.equal(typeof child, 'string');
      if (openApiDocument) assert.ok((child as string).startsWith('#/components/schemas/'));
      pointer(root, child as string);
    } else checkRefs(child, root, openApiDocument);
  }
}
function expand(value: unknown, root = value): unknown {
  if (Array.isArray(value)) return value.map((item) => expand(item, root));
  if (!value || typeof value !== 'object') return value;
  const { $defs: _, $schema: _dialect, $ref, ...rest } = value as Record<string, unknown>;
  const children = Object.fromEntries(
    Object.entries(rest).map(([key, child]) => [key, expand(child, root)]),
  );
  return $ref
    ? { ...(expand(pointer(root, String($ref)), root) as object), ...children }
    : children;
}
const inline = (schema: z.ZodType) =>
  json(z.toJSONSchema(schema, { target: 'draft-2020-12', reused: 'inline' }));

test('standalone MCP references and global OpenAPI components resolve without network dependencies', async () => {
  for (const discovery of [mcpDiscovery(), hostedMcpDiscovery()]) {
    for (const tool of discovery.tools) {
      checkRefs(json(tool.inputSchema));
      checkRefs(json(tool.outputSchema));
    }
  }
  for (const spec of [openApi(), hostedOpenApi()]) {
    checkRefs(json(spec), json(spec), true);
    await SwaggerParser.validate(structuredClone(spec) as never);
  }
});

test('deduplication retains every canonical input and output constraint, including hosted target inputs', () => {
  const registry = { ...operations, ...controlOperations };
  const spec = json(hostedOpenApi()) as {
    paths: Record<
      string,
      Record<
        string,
        {
          requestBody?: { content: Record<string, { schema: unknown }> };
          responses: Record<string, { content: Record<string, { schema: unknown }> }>;
        }
      >
    >;
  };
  for (const [name, operation] of Object.entries(registry)) {
    for (const side of ['input', 'output'] as const)
      assert.deepEqual(
        expand(json(jsonSchema(operation[side]))),
        expand(inline(operation[side])),
        name + ' ' + side,
      );
    const route = spec.paths[operation.path]![operation.method.toLowerCase()]!;
    assert.deepEqual(
      expand(route.responses['200']!.content['application/json']!.schema, spec),
      expand(inline(operation.output)),
      name + ' OpenAPI output',
    );
    if (route.requestBody)
      assert.deepEqual(
        expand(route.requestBody.content['application/json']!.schema, spec),
        expand(inline(operation.input)),
        name + ' OpenAPI input',
      );
  }
  for (const tool of hostedMcpDiscovery().tools) {
    const operation = registry[tool.name as keyof typeof registry];
    const target = !('target' in operation) || operation.target;
    assert.deepEqual(
      expand(json(tool.inputSchema)),
      expand(
        inline(target ? operation.input.extend({ tenantId: z.string().uuid() }) : operation.input),
      ),
    );
  }
});

test('the installed MCP SDK accepts and rejects the same nested insurance and loss-notice payloads before and after deduplication', () => {
  const configured = setupConfiguredV2(),
    fnol = fnolFixture();
  try {
    const bound = configured.bind(configured.create());
    const notice = fnol.create();
    const cases: [z.ZodType, unknown, unknown[]][] = [
      [
        operations.insurance_evaluate_product.input,
        {
          productId: bound.productId,
          productVersion: bound.productVersion,
          submission: multiRiskSubmission,
        },
        [
          {
            productId: bound.productId,
            productVersion: bound.productVersion,
            submission: { ...multiRiskSubmission, unexpected: true },
          },
        ],
      ],
      [
        operations.insurance_get.output,
        { record: bound },
        [
          { record: { ...bound, premiumMinor: 1 } },
          { record: { ...bound, scope: { ...bound.scope, unexpected: true } } },
        ],
      ],
      [
        operations.fnol_create.input,
        fnol.command(),
        [{ ...fnol.command(), details: { ...syntheticFnolDetails, unexpected: true } }],
      ],
      [
        operations.fnol_get.output,
        notice,
        [
          { ...notice, notice: { ...notice.notice, version: 0 } },
          { ...notice, unexpected: true },
        ],
      ],
      [
        controlOperations.control_setup.output,
        configured.inspect(),
        [{ ...configured.inspect(), activeRelease: { id: randomUUID() } }],
      ],
    ];
    const validator = new AjvJsonSchemaValidator();
    for (const [schema, valid, invalid] of cases) {
      const beforeSchema = inline(schema) as Record<string, unknown>;
      delete beforeSchema.$schema;
      const before = validator.getValidator(beforeSchema),
        after = validator.getValidator(json(jsonSchema(schema)) as Record<string, unknown>);
      for (const [value, expected] of [
        [valid, true],
        ...invalid.map((value) => [value, false]),
      ] as [unknown, boolean][]) {
        assert.equal(schema.safeParse(value).success, expected);
        assert.equal(before(value).valid, expected);
        assert.equal(after(value).valid, expected);
      }
    }
  } finally {
    configured.store.close();
    fnol.store.close();
  }
});

test('a real MCP SDK client discovers all permitted tools and validates retained v2 results against local definitions', async () => {
  const fixture = setupConfiguredV2(),
    token = randomUUID() + randomUUID();
  const bound = fixture.bind(fixture.create());
  const { correlationId: _, ...credentialContext } = fixture.context;
  const app = buildApp({
    kernel: fixture.kernel,
    credentials: [{ token, context: { ...credentialContext, permissions: [...permissions] } }],
  });
  const client = new Client({ name: 'deduplicated-contract-conformance', version: '1.0.0' });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(address + '/mcp'), {
        requestInit: { headers: { authorization: 'Bearer ' + token } },
      }),
    );
    const discovery = await client.listTools();
    assert.deepEqual(discovery, json(mcpDiscovery()));
    const result = await client.callTool({
      name: 'insurance_history',
      arguments: { recordId: bound.id },
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(
      result.structuredContent,
      json(fixture.store.insuranceHistory(fixture.context, bound.id)),
    );
    const denied = await client.callTool({
      name: 'insurance_history',
      arguments: { recordId: bound.id, tenantId: randomUUID() },
    });
    assert.equal(denied.isError, true);
  } finally {
    await client.close();
    await app.close();
    fixture.store.close();
  }
});

test('cached contracts stay immutable and hosted construction cannot alter development or permission-scoped manifests', () => {
  const development = openApi(),
    initialHash = hash(development);
  const hosted = hostedOpenApi();
  assert.equal(openApi(), development);
  assert.equal(hostedOpenApi(), hosted);
  assert.equal(hash(development), initialHash);
  assert.throws(() => {
    development.info.title = 'incorrect';
  }, TypeError);
  assert.throws(() => {
    mcpDiscovery().tools.pop();
  }, TypeError);
  const reader = scopedMcpDiscovery(['configuration:read']);
  assert.equal(scopedMcpDiscovery(['configuration:read', 'not-a-permission']), reader);
  assert.notEqual(reader, scopedMcpDiscovery([...permissions]));
  assert.equal(contractManifest(['configuration:read']).mcpHash, hash(reader));
  assert.equal(hostedContractManifest().openapiHash, hash(hosted));
  assert.ok(
    Buffer.byteLength(JSON.stringify(hosted)) < 1_600_000,
    'Guard against accidental schema reinlining',
  );
  assert.ok(Buffer.byteLength(JSON.stringify(hostedMcpDiscovery())) < 900_000);
});
