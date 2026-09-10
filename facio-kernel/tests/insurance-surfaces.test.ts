import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import SwaggerParser from '@apidevtools/swagger-parser';
import { Kernel } from '../src/application/kernel.js';
import { Store } from '../src/storage/store.js';
import { buildApp } from '../src/server/app.js';
import { openApi } from '../src/contracts/artifacts.js';
import { insuranceMutationResultSchema, insuranceOperations } from '../src/contracts/insurance.js';
import type { Credential } from '../src/server/auth.js';
import {
  insuranceContext,
  scopedRuntimePolicy,
  runtimePolicy,
  externalQuote,
  testNow,
} from './fixtures/insurance.js';

test('OpenAPI preserves both quote mutation methods and documents every POST body', async () => {
  const document = openApi();
  await SwaggerParser.validate(structuredClone(document) as never);
  const paths = document.paths as Record<
    string,
    Record<string, { requestBody?: unknown; operationId?: string }>
  >;
  assert.equal(paths['/api/insurance/quotes']?.post?.operationId, 'insurance_create_quote');
  assert.equal(paths['/api/insurance/quotes']?.put?.operationId, 'insurance_revise_quote');
  for (const operation of Object.values(insuranceOperations))
    if (operation.method !== 'GET')
      assert.ok(paths[operation.path]?.[operation.method.toLowerCase()]?.requestBody);
});

test('real HTTP lifecycle uses canonical record versions; scoped reads match MCP and AI mutations stay disabled', async () => {
  const store = new Store(':memory:');
  const { correlationId: _, ...credentialContext } = insuranceContext;
  const credentials: Credential[] = [
    { token: randomUUID() + randomUUID(), context: credentialContext },
    {
      token: randomUUID() + randomUUID(),
      context: { ...credentialContext, tenantId: 'other-tenant' },
    },
    {
      token: randomUUID() + randomUUID(),
      context: { ...credentialContext, actorId: 'reader', permissions: ['insurance:read'] },
    },
  ];
  const app = buildApp({
    kernel: new Kernel(store, [], [scopedRuntimePolicy], testNow),
    credentials,
  });
  const client = new Client({ name: 'insurance-read-test', version: '1.0.0' });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const headers = (index = 0) => ({
      authorization: 'Bearer ' + credentials[index]!.token,
      'content-type': 'application/json',
    });
    const send = async (method: string, path: string, input: unknown, index = 0) =>
      fetch(address + path, { method, headers: headers(index), body: JSON.stringify(input) });
    assert.equal((await fetch(address + '/api/insurance/catalog')).status, 401);
    const createdResponse = await send('POST', '/api/insurance/quotes', {
      idempotencyKey: randomUUID(),
      productId: runtimePolicy.id,
      productVersion: runtimePolicy.version,
      quote: externalQuote,
    });
    assert.equal(createdResponse.status, 200);
    const created = insuranceMutationResultSchema.parse(await createdResponse.json());
    for (const premiumMinor of ['abc', '1.5', 'NaN']) {
      const invalid = await send('POST', '/api/insurance/quotes', {
        idempotencyKey: randomUUID(),
        productId: runtimePolicy.id,
        productVersion: runtimePolicy.version,
        quote: { ...externalQuote, premiumMinor },
      });
      assert.equal(invalid.status, 422);
      assert.equal((await invalid.json()).error.code, 'VALIDATION_ERROR');
    }
    const revisedResponse = await send('PUT', '/api/insurance/quotes', {
      idempotencyKey: randomUUID(),
      recordId: created.record.id,
      expectedVersion: created.record.version,
      recordHash: created.record.recordHash,
      quote: {
        ...externalQuote,
        premiumMinor: '25001',
        sourceQuote: { ...externalQuote.sourceQuote, version: '2' },
      },
    });
    assert.equal(revisedResponse.status, 200);
    const revised = insuranceMutationResultSchema.parse(await revisedResponse.json());
    const binding = {
      idempotencyKey: randomUUID(),
      recordId: revised.record.id,
      expectedVersion: revised.record.version,
      quoteHash: revised.record.quoteHash,
    };
    const denied = await send('POST', '/api/insurance/bind', binding, 2);
    assert.equal(denied.status, 403);
    assert.equal(
      (await send('POST', '/api/insurance/bind', { ...binding, premiumMinor: '1' })).status,
      422,
    );
    const boundResponse = await send('POST', '/api/insurance/bind', binding);
    assert.equal(boundResponse.status, 200);
    const bound = insuranceMutationResultSchema.parse(await boundResponse.json());
    assert.equal(bound.record.premiumMinor, '25001');
    assert.deepEqual(await (await send('POST', '/api/insurance/bind', binding)).json(), bound);
    assert.equal(
      (await send('POST', '/api/insurance/bind', { ...binding, idempotencyKey: randomUUID() }))
        .status,
      409,
    );
    const serviced = await send('POST', '/api/insurance/service', {
      idempotencyKey: randomUUID(),
      recordId: bound.record.id,
      expectedVersion: bound.record.version,
      recordHash: bound.record.recordHash,
      action: 'endorsement',
      premiumDeltaMinor: '99',
      effectiveDate: '2026-09-10',
      reason: 'Manual test endorsement',
    });
    assert.equal(serviced.status, 200);
    assert.equal(
      insuranceMutationResultSchema.parse(await serviced.json()).record.premiumMinor,
      '25100',
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(address + '/mcp'), {
        requestInit: { headers: headers() },
      }),
    );
    const discovery = await client.listTools();
    assert.deepEqual(discovery.tools.map((tool) => tool.name).sort(), [
      'approval_get',
      'approval_list',
      'insurance_catalog',
      'insurance_evaluate_cancellation',
      'insurance_evaluate_product',
      'insurance_evaluate_renewal',
      'insurance_evaluate_service',
      'insurance_get',
      'insurance_history',
      'insurance_list',
      'insurance_record_definition',
    ]);
    for (const [name, path, args] of [
      ['insurance_catalog', '/api/insurance/catalog', {}],
      ['insurance_list', '/api/insurance/records', {}],
      [
        'insurance_get',
        '/api/insurance/record?recordId=' + bound.record.id,
        { recordId: bound.record.id },
      ],
      [
        'insurance_history',
        '/api/insurance/history?recordId=' + bound.record.id,
        { recordId: bound.record.id },
      ],
    ] as const) {
      const http = await fetch(address + path, { headers: headers() }).then((response) =>
        response.json(),
      );
      const mcp = await client.callTool({ name, arguments: args });
      assert.deepEqual(mcp.structuredContent, http);
    }
    for (const name of [
      'insurance_create_quote',
      'insurance_revise_quote',
      'insurance_bind',
      'insurance_service',
    ]) {
      const disabled = await client.callTool({ name, arguments: binding });
      assert.equal(disabled.isError, true);
      const content = disabled.content as { type: string; text: string }[];
      assert.equal(JSON.parse(content[0]!.text).error.code, 'TRANSPORT_NOT_ALLOWED');
    }
    assert.equal(
      (
        await fetch(address + '/api/insurance/record?recordId=' + bound.record.id, {
          headers: headers(1),
        })
      ).status,
      404,
    );
    assert.deepEqual(
      await fetch(address + '/api/insurance/records', { headers: headers(1) }).then((response) =>
        response.json(),
      ),
      { records: [], hasMore: false },
    );
    assert.equal(
      (
        await fetch(address + '/api/insurance/catalog?tenantId=other-tenant', {
          headers: headers(),
        })
      ).status,
      422,
    );
    assert.equal(store.insuranceOutbox(insuranceContext).length, 4);
    assert.ok(
      store
        .audits(insuranceContext)
        .some(
          (row) => row.operation === 'insurance_bind' && row.outcome === 'TRANSPORT_NOT_ALLOWED',
        ),
    );
  } finally {
    await client.close();
    await app.close();
    store.close();
  }
});
