import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApp } from '../src/server/app.js';
import { setupConfiguredV2 } from './fixtures/configured-v2.js';
import { multiRiskSubmission } from './fixtures/insurance-v2.js';

test('MCP and HTTP share exact service/cancellation/renewal previews; all execution mutations remain hidden and denied', async () => {
  const f = setupConfiguredV2(),
    record = f.bind(f.create()),
    { correlationId: _, ...credentialContext } = f.context,
    token = randomBytes(32).toString('hex');
  const app = buildApp({ kernel: f.kernel, credentials: [{ token, context: credentialContext }] }),
    client = new Client({ name: 'v2-parity', version: '1' });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 }),
      headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    await client.connect(
      new StreamableHTTPClientTransport(new URL(address + '/mcp'), { requestInit: { headers } }),
    );
    const discovered = (await client.listTools()).tools;
    for (const name of [
      'insurance_service_configured',
      'insurance_cancel_configured',
      'insurance_create_renewal_quote',
    ]) {
      assert.equal(
        discovered.some((tool) => tool.name === name),
        false,
      );
      assert.equal((await client.callTool({ name, arguments: {} })).isError, true);
    }
    const s = structuredClone(multiRiskSubmission);
    s.version = '2';
    s.term.endDate = '2026-09-15';
    const target = {
      recordId: record.id,
      expectedVersion: record.version,
      recordHash: record.recordHash,
      effectiveDate: '2026-09-10',
      reason: 'Synthetic surface conformance',
      evidenceRefs: ['synthetic://surfaces'],
    };
    const renewal = structuredClone(multiRiskSubmission);
    renewal.reference = 'synthetic-renewal-surface';
    renewal.term = { startDate: '2026-09-14', endDate: '2026-09-17' };
    const samples = [
      {
        name: 'insurance_evaluate_service',
        path: '/api/insurance/service/evaluate',
        input: { ...target, submission: s },
      },
      {
        name: 'insurance_evaluate_cancellation',
        path: '/api/insurance/cancellation/evaluate',
        input: target,
      },
      {
        name: 'insurance_evaluate_renewal',
        path: '/api/insurance/renewal/evaluate',
        input: {
          sourceRecordId: record.id,
          sourceVersion: record.version,
          sourceRecordHash: record.recordHash,
          productId: record.productId,
          productVersion: record.productVersion,
          submission: renewal,
        },
      },
    ];
    const before = f.store.insuranceOutbox(f.context),
      history = f.store.insuranceHistory(f.context, record.id);
    for (const sample of samples) {
      const response = await fetch(address + sample.path, {
        method: 'POST',
        headers,
        body: JSON.stringify(sample.input),
      });
      assert.equal(response.status, 200);
      const http = await response.json();
      assert.equal(
        discovered.find((tool) => tool.name === sample.name)?.annotations?.readOnlyHint,
        true,
      );
      assert.deepEqual(
        (await client.callTool({ name: sample.name, arguments: sample.input })).structuredContent,
        http,
      );
    }
    assert.deepEqual(f.store.insuranceOutbox(f.context), before);
    assert.deepEqual(f.store.insuranceHistory(f.context, record.id), history);
  } finally {
    await client.close();
    await app.close();
    f.store.close();
  }
});
