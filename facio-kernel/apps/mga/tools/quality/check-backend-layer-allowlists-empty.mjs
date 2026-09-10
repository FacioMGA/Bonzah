#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const target = path.join(process.cwd(), 'tools', 'quality', 'check-backend-layer-imports.mjs');
const source = fs.readFileSync(target, 'utf8');

function countEntries(constName) {
  const startMarker = `const ${constName} = new Set([`;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) return null;
  const bodyStart = startIdx + startMarker.length;
  const endIdx = source.indexOf(']);', bodyStart);
  if (endIdx === -1) return null;
  const body = source.slice(bodyStart, endIdx);
  return (body.match(/'server\/src\//g) || []).length;
}

const layerCount = countEntries('LEGACY_LAYER_EDGE_ALLOWLIST');
const ioCount = countEntries('LEGACY_DOMAIN_IO_ALLOWLIST');

if (layerCount === null || ioCount === null) {
  console.error('allowlist empty guard failed: could not locate expected allowlist constants');
  process.exit(1);
}

if (layerCount > 0 || ioCount > 0) {
  console.error(
    `allowlist empty guard failed: LEGACY_LAYER_EDGE_ALLOWLIST=${layerCount}, LEGACY_DOMAIN_IO_ALLOWLIST=${ioCount}`
  );
  process.exit(1);
}

console.log('allowlist empty guard OK');
