#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const graphPath = path.join(root, 'docs', 'architecture', 'backend-dependency-graph.svg');

if (!fs.existsSync(graphPath)) {
  console.error('\n[backend-dependency-graph] FAILED\n');
  console.error(' - missing artifact: docs/architecture/backend-dependency-graph.svg\n');
  process.exit(1);
}

const stat = fs.statSync(graphPath);
if (stat.size < 50_000) {
  console.error('\n[backend-dependency-graph] FAILED\n');
  console.error(` - artifact is unexpectedly small (${stat.size} bytes): docs/architecture/backend-dependency-graph.svg`);
  console.error(' - regenerate with: npm run docs:backend-dependency-graph\n');
  process.exit(1);
}

console.log(`[backend-dependency-graph] OK (${stat.size} bytes)`);
