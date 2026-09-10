import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildApp } from '../src/server/app.js';
import { Store } from '../src/storage/store.js';
import { Kernel } from '../src/application/kernel.js';
import { operations } from '../src/contracts/operations.js';
import {
  contractManifest,
  mcpDiscovery,
  openApi,
  verifyContractManifest,
} from '../src/contracts/artifacts.js';
import {
  referenceScope,
  referenceConfiguration,
  incompleteScope,
  incompleteConfiguration,
} from '../src/fixtures/reference.js';
import type { Credential } from '../src/server/auth.js';
import { hash } from '../src/domain/canonical.js';
import { syntheticScopedRequirements } from './fixtures/requirements.js';
const credentials: Credential[] = [referenceScope, incompleteScope].map((scope) => ({
  token: randomUUID() + randomUUID(),
  context: {
    ...scope,
    actorId: 'editor',
    permissions: ['configuration:read', 'configuration:write', 'audit:read'],
  },
}));
const headers = (index = 0) => ({ authorization: 'Bearer ' + credentials[index]!.token });
function setup(maxRequestsPerMinute?: number) {
  const store = new Store(':memory:');
  store.seed(referenceScope, referenceConfiguration, referenceConfiguration);
  store.seed(incompleteScope, incompleteConfiguration);
  return {
    store,
    app: buildApp({
      kernel: new Kernel(store, [syntheticScopedRequirements]),
      credentials,
      maxRequestsPerMinute,
    }),
  };
}

test('OpenAPI validates and a contract mismatch blocks current publication', async () => {
  await SwaggerParser.validate(structuredClone(openApi()) as never);
  verifyContractManifest(contractManifest());
  assert.throws(
    () => verifyContractManifest({ ...contractManifest(), mcpHash: 'wrong' }),
    /differ from this build/,
  );
  assert.equal(
    mcpDiscovery().tools.length,
    Object.values(operations).filter(
      (operation) => !('mcp' in operation) || operation.mcp !== false,
    ).length,
  );
});
test('HTTP enforces authentication, strict inputs, origin protection, scoped gaps and version conflicts', async () => {
  const { store, app } = setup();
  try {
    assert.equal((await app.inject('/api/catalog')).statusCode, 401);
    assert.equal((await app.inject('/api/requirements')).statusCode, 401);
    assert.equal(
      (await app.inject({ url: '/api/requirements?tenantId=incomplete', headers: headers() }))
        .statusCode,
      422,
    );
    const requirements = await app.inject({ url: '/api/requirements', headers: headers() });
    assert.equal(requirements.json().sourceStatus, 'source_attached');
    assert.equal(requirements.json().runtimeStatus, 'pending_evidence');
    const missingRequirements = await app.inject({ url: '/api/requirements', headers: headers(1) });
    assert.equal(missingRequirements.json().sourceStatus, 'source_not_attached');
    assert.equal(missingRequirements.json().profile, null);
    assert.equal(
      (await app.inject({ url: '/api/catalog', headers: { ...headers(), host: 'evil.example' } }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: '/api/catalog',
          headers: { ...headers(), origin: 'https://evil.example' },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: '/api/configuration?view=draft&tenantId=incomplete',
          headers: headers(),
        })
      ).statusCode,
      422,
    );
    const complete = await app.inject({ url: '/api/gaps?view=draft', headers: headers() });
    assert.equal(complete.statusCode, 200);
    assert.equal(complete.json().definitionValid, true);
    assert.equal(complete.json().productionReady, false);
    const incomplete = await app.inject({ url: '/api/gaps?view=draft', headers: headers(1) });
    assert.equal(incomplete.json().definitionValid, false);
    assert.ok(
      incomplete.json().gaps.every((gap: { tenantId: string }) => gap.tenantId === 'incomplete'),
    );
    assert.equal(
      (await app.inject({ url: '/api/configuration?view=published', headers: headers(1) }))
        .statusCode,
      404,
    );
    const input = {
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      configuration: referenceConfiguration,
    };
    assert.equal(
      (await app.inject({ method: 'PUT', url: '/api/draft', headers: headers(), payload: input }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/draft',
          headers: headers(),
          payload: { ...input, idempotencyKey: randomUUID() },
        })
      ).statusCode,
      409,
    );
  } finally {
    await app.close();
    store.close();
  }
});
test('rate limit is enforced per credential', async () => {
  const { store, app } = setup(1);
  try {
    assert.equal((await app.inject({ url: '/api/catalog', headers: headers() })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/catalog', headers: headers() })).statusCode, 429);
    assert.equal((await app.inject({ url: '/api/catalog', headers: headers(1) })).statusCode, 200);
  } finally {
    await app.close();
    store.close();
  }
});
test('requirements are denied without configuration read permission on HTTP and MCP', async () => {
  const store = new Store(':memory:');
  const credential: Credential = {
    token: randomUUID() + randomUUID(),
    context: { ...referenceScope, actorId: 'writer-only', permissions: ['configuration:write'] },
  };
  const app = buildApp({
    kernel: new Kernel(store, [syntheticScopedRequirements]),
    credentials: [credential],
  });
  const client = new Client({ name: 'requirements-denial-test', version: '1.0.0' });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const authorization = { authorization: 'Bearer ' + credential.token };
    const deniedHttp = await fetch(address + '/api/requirements', { headers: authorization });
    assert.equal(deniedHttp.status, 403);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(address + '/mcp'), {
        requestInit: { headers: authorization },
      }),
    );
    assert.equal(
      (await client.listTools()).tools.some((tool) => tool.name === 'configuration_requirements'),
      false,
    );
    const deniedMcp = await client.callTool({ name: 'configuration_requirements', arguments: {} });
    assert.equal(deniedMcp.isError, true);
    assert.equal(
      store
        .audits(referenceScope)
        .filter(
          (record) =>
            record.operation === 'configuration_requirements' && record.outcome === 'FORBIDDEN',
        ).length,
      2,
    );
  } finally {
    await client.close();
    await app.close();
    store.close();
  }
});
test('real MCP client discovery/read/write matches HTTP for both tenants', async () => {
  const { store, app } = setup();
  const clients: Client[] = [];
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    for (let i = 0; i < 2; i++) {
      const client = new Client({ name: 'conformance-test', version: '1.0.0' });
      clients.push(client);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(address + '/mcp'), {
          requestInit: { headers: headers(i) },
        }),
      );
      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map((t) => t.name).sort(),
        Object.entries(operations)
          .filter(
            ([, operation]) =>
              credentials[i]!.context.permissions.includes(operation.permission) &&
              (!('mcp' in operation) || operation.mcp !== false),
          )
          .map(([name]) => name)
          .sort(),
      );
      const artifact = await fetch(address + '/api/mcp-discovery', { headers: headers(i) }).then(
        (r) => r.json(),
      );
      assert.deepEqual(tools, artifact);
      const requirementsMcp = await client.callTool({
        name: 'configuration_requirements',
        arguments: {},
      });
      const requirementsHttp = await fetch(address + '/api/requirements', {
        headers: headers(i),
      }).then((response) => response.json());
      assert.deepEqual(requirementsMcp.structuredContent, requirementsHttp);
      const requirementsDenied = await client.callTool({
        name: 'configuration_requirements',
        arguments: { tenantId: 'foreign' },
      });
      assert.equal(requirementsDenied.isError, true);
      for (const [name, path] of [
        ['configuration_inspect', '/api/configuration'],
        ['configuration_gaps', '/api/gaps'],
      ] as const) {
        const mcp = await client.callTool({ name, arguments: { view: 'draft' } });
        const http = await fetch(address + path + '?view=draft', { headers: headers(i) }).then(
          (r) => r.json(),
        );
        assert.deepEqual(mcp.structuredContent, http);
      }
      const denied = await client.callTool({
        name: 'configuration_inspect',
        arguments: { view: 'draft', tenantId: credentials[1 - i]!.context.tenantId },
      });
      assert.equal(denied.isError, true);
    }
    const update = structuredClone(referenceConfiguration);
    update.tenant!.displayName = 'MCP edit';
    const input = { expectedVersion: 1, idempotencyKey: randomUUID(), configuration: update };
    const result = await clients[0]!.callTool({
      name: 'configuration_update_draft',
      arguments: input,
    });
    assert.equal(result.isError, undefined);
    const replay = await fetch(address + '/api/draft', {
      method: 'PUT',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => r.json());
    assert.deepEqual(result.structuredContent, replay);
    assert.equal(store.read(incompleteScope, 'draft').version, 1);
    assert.equal(
      store.read(referenceScope, 'published').configuration.tenant?.displayName,
      'Reference workspace',
    );
  } finally {
    for (const client of clients) await client.close();
    await app.close();
    store.close();
  }
});
test('reader MCP denials are audited and the scoped discovery matches its manifest hash', async () => {
  const store = new Store(':memory:');
  store.seed(referenceScope, referenceConfiguration, referenceConfiguration);
  const reader: Credential = {
    token: randomUUID() + randomUUID(),
    context: { ...referenceScope, actorId: 'reader', permissions: ['configuration:read'] },
  };
  const app = buildApp({ kernel: new Kernel(store), credentials: [reader] });
  const client = new Client({ name: 'reader-test', version: '1.0.0' });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const authHeaders = { authorization: 'Bearer ' + reader.token };
    await client.connect(
      new StreamableHTTPClientTransport(new URL(address + '/mcp'), {
        requestInit: { headers: authHeaders },
      }),
    );
    const discovery = await client.listTools();
    assert.equal(
      discovery.tools.length,
      Object.values(operations).filter((operation) => operation.permission === 'configuration:read')
        .length,
    );
    const manifest = await fetch(address + '/api/manifest', { headers: authHeaders }).then((r) =>
      r.json(),
    );
    assert.equal(manifest.mcpHash, hash(discovery));
    const badInput = await client.callTool({
      name: 'configuration_inspect',
      arguments: { view: 'draft', tenantId: 'foreign' },
    });
    assert.equal(badInput.isError, true);
    const denied = await client.callTool({
      name: 'configuration_update_draft',
      arguments: {
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        configuration: referenceConfiguration,
      },
    });
    assert.equal(denied.isError, true);
    const records = store.audits(referenceScope);
    assert.ok(records.some((row) => row.outcome === 'VALIDATION_ERROR'));
    assert.ok(records.some((row) => row.outcome === 'FORBIDDEN'));
    assert.equal(store.read(referenceScope, 'draft').version, 1);
  } finally {
    await client.close();
    await app.close();
    store.close();
  }
});
