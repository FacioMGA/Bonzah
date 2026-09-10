import { mkdir, writeFile } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import {
  openApi,
  mcpDiscovery,
  contractManifest,
  hostedOpenApi,
  hostedMcpDiscovery,
  hostedContractManifest,
} from '../src/contracts/artifacts.js';
const spec = openApi();
await SwaggerParser.validate(structuredClone(spec) as never);
const hostedSpec = hostedOpenApi();
await SwaggerParser.validate(structuredClone(hostedSpec) as never);
await mkdir('artifacts/contracts', { recursive: true });
for (const [name, data] of Object.entries({
  'openapi.json': spec,
  'mcp-discovery.json': mcpDiscovery(),
  'manifest.json': contractManifest(),
  'hosted-openapi.json': hostedSpec,
  'hosted-mcp-discovery.json': hostedMcpDiscovery(),
  'hosted-manifest.json': hostedContractManifest(),
}))
  await writeFile('artifacts/contracts/' + name, JSON.stringify(data, null, 2) + '\n');
console.log('Validated OpenAPI 3.1 and generated canonical MCP and contract hash artifacts.');
