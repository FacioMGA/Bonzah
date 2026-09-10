import test from 'node:test';
import assert from 'node:assert/strict';
import SwaggerParser from '@apidevtools/swagger-parser';
import {
  hostedOpenApi,
  hostedMcpDiscovery,
  hostedContractManifest,
  verifyHostedContractManifest,
  contractManifest,
  jsonSchema,
} from '../src/contracts/artifacts.js';
import { controlOperations } from '../src/contracts/control-plane.js';
import { operations } from '../src/contracts/operations.js';
import { hash } from '../src/domain/canonical.js';

test('hosted OpenAPI and MCP describe the same control operations, explicit resource targets and current auth boundary', async () => {
  const spec = hostedOpenApi();
  await SwaggerParser.validate(structuredClone(spec) as never);
  const discovery = hostedMcpDiscovery();
  const tools = new Map(discovery.tools.map((tool) => [tool.name, tool]));
  for (const [name, operation] of Object.entries(controlOperations)) {
    const allowed = !('mcp' in operation) || operation.mcp !== false;
    assert.equal(tools.has(name), allowed);
    if (allowed) {
      const schema = tools.get(name)!.inputSchema;
      assert.deepEqual(tools.get(name)!.outputSchema, {
        type: 'object',
        ...jsonSchema(operation.output),
      });
      assert.equal(schema.required?.includes('tenantId') ?? false, operation.target);
    }
    const route = spec.paths[operation.path]![operation.method.toLowerCase()]!;
    assert.equal(route.operationId, name);
    assert.equal(
      (route.parameters as { name: string }[]).some((p) => p.name === 'X-Kernel-Tenant-Id'),
      operation.target,
    );
    assert.deepEqual(route.security, [{ sessionCookie: [] }]);
  }
  for (const [name, operation] of Object.entries(operations)) {
    assert.equal(tools.has(name), !('mcp' in operation) || operation.mcp !== false);
    const route = spec.paths[operation.path]![operation.method.toLowerCase()]!;
    assert.ok(
      (route.parameters as { name: string }[]).some((p) => p.name === 'X-Kernel-Tenant-Id'),
    );
    if (tools.has(name)) assert.ok(tools.get(name)!.inputSchema.required?.includes('tenantId'));
  }
  assert.equal(tools.has('control_revoke_membership'), false);
  assert.equal(tools.get('control_activate')!.annotations.destructiveHint, true);
  assert.equal(tools.get('control_rollback')!.annotations.destructiveHint, true);
  assert.equal(spec.components.securitySchemes.sessionCookie.name, '__Host-kernel_session');
});

test('hosted manifests hash the actual hosted contracts and never reuse development discovery hashes', () => {
  const observed = hostedContractManifest('a'.repeat(40));
  verifyHostedContractManifest(observed);
  assert.equal(observed.openapiHash, hash(hostedOpenApi()));
  assert.equal(observed.mcpHash, hash(hostedMcpDiscovery()));
  assert.notEqual(observed.mcpHash, contractManifest().mcpHash);
  assert.notEqual(observed.openapiHash, contractManifest().openapiHash);
  assert.equal(observed.status, 'hosted-sandbox');
  assert.equal(observed.buildSha, 'a'.repeat(40));
  assert.throws(
    () => verifyHostedContractManifest({ ...observed, mcpHash: contractManifest().mcpHash }),
    /differ from this build/,
  );
});
