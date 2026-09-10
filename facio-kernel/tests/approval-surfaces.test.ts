import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  approvalFixture,
  approvalReviewer,
  approvalOtherReviewer,
  reviewEvidence,
} from './fixtures/approval.js';
import { approvalResultSchema } from '../src/contracts/approval.js';
import { insuranceMutationResultSchema } from '../src/contracts/insurance.js';
import { buildApp } from '../src/server/app.js';

test('HTTP independent review uses canonical roles and evidence; MCP reads agree while all review mutations are denied', async () => {
  const f = approvalFixture();
  const contexts = [
    f.context,
    f.kernel.control.resolveContext(approvalReviewer, f.tenant.id),
    f.kernel.control.resolveContext(approvalOtherReviewer, f.tenant.id),
  ];
  const credentials = contexts.map(({ correlationId: _, ...context }) => ({
    context,
    token: randomUUID() + randomUUID(),
  }));
  const app = buildApp({ kernel: f.kernel, credentials });
  const client = new Client({ name: 'human-review-boundary', version: '1' });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const headers = (actor = 0) => ({
      authorization: 'Bearer ' + credentials[actor]!.token,
      'content-type': 'application/json',
    });
    const post = (path: string, body: unknown, actor = 0) =>
      fetch(address + path, {
        method: 'POST',
        headers: headers(actor),
        body: JSON.stringify(body),
      });
    const record = f.create();
    const requestInput = f.requestInput(record);
    assert.equal(
      (await post('/api/insurance/approvals', { ...requestInput, actorId: 'approval-reviewer' }))
        .status,
      422,
    );
    const response = await post('/api/insurance/approvals', requestInput);
    assert.equal(response.status, 200);
    const requested = approvalResultSchema.parse(await response.json());
    const decision = f.decisionInput(requested.approval);
    assert.equal((await post('/api/insurance/approval/decision', decision)).status, 403);
    assert.equal(
      (await post('/api/insurance/approval/decision', { ...decision, evidenceRefs: [] }, 1)).status,
      422,
    );
    const approvedResponse = await post('/api/insurance/approval/decision', decision, 1);
    assert.equal(approvedResponse.status, 200);
    const approved = approvalResultSchema.parse(await approvedResponse.json());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(address + '/mcp'), {
        requestInit: { headers: headers(1) },
      }),
    );
    const tools = await client.listTools();
    for (const name of ['approval_request', 'approval_decide', 'approval_revoke']) {
      assert.equal(
        tools.tools.some((tool) => tool.name === name),
        false,
      );
      const denied = await client.callTool({ name, arguments: decision });
      assert.equal(denied.isError, true);
      assert.equal(
        JSON.parse((denied.content as { text: string }[])[0]!.text).error.code,
        'TRANSPORT_NOT_ALLOWED',
      );
    }
    for (const [name, path, args] of [
      ['approval_list', '/api/insurance/approvals?recordId=' + record.id, { recordId: record.id }],
      [
        'approval_get',
        '/api/insurance/approval?approvalId=' + approved.approval.id,
        { approvalId: approved.approval.id },
      ],
    ] as const) {
      const http = await fetch(address + path, { headers: headers(1) }).then((response) =>
        response.json(),
      );
      const mcp = await client.callTool({ name, arguments: args });
      assert.deepEqual(mcp.structuredContent, http);
    }
    assert.equal(f.store.insuranceOutbox(f.context).length, 1);
    const boundResponse = await post('/api/insurance/bind', {
      idempotencyKey: randomUUID(),
      recordId: record.id,
      expectedVersion: record.version,
      quoteHash: record.quoteHash,
      approvalId: approved.approval.id,
    });
    assert.equal(boundResponse.status, 200);
    assert.equal(
      insuranceMutationResultSchema.parse(await boundResponse.json()).record.approval!.approvalId,
      approved.approval.id,
    );
    assert.equal(f.store.insuranceOutbox(f.context).length, 2);
  } finally {
    await client.close();
    await app.close();
    f.store.close();
  }
});
