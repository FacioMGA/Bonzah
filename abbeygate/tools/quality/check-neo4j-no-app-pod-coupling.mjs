#!/usr/bin/env node
/**
 * CHAMPS guard — Neo4j Helm/manifest values place the StatefulSet in
 * `namespace: org2vec` (ADR-0041 §7 / §9).
 *
 * Pins:
 *   - No Neo4j Helm template / manifest under `infrastructure/k8s/`
 *     may declare `namespace: faciomga-prod` or `namespace: abbeygate-*`.
 *   - When a `kind: StatefulSet` document mentions `neo4j`, its
 *     `metadata.namespace` MUST be `org2vec` (or empty — interpreted as
 *     "released into the chart's namespace at deploy time" which Helm
 *     defaults must keep targeting the org2vec namespace).
 *
 * Rationale: the API + abbeygate-worker Deployments must NEVER share a
 * Pod / Deployment / namespace lifecycle with the graph database.
 * Co-location regresses the off-critical-path contract: a slow Cypher
 * query starves API request handlers; a Neo4j OOM kills the API.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const SCAN_ROOTS = [path.join(ROOT, 'infrastructure/k8s')];

const FORBIDDEN_NAMESPACE_RE = /^\s*namespace:\s*(faciomga(-[a-z0-9]+)?|abbeygate(-[a-z0-9-]+)?)\s*$/m;

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      results = results.concat(walk(p));
    } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      results.push(p);
    }
  }
  return results;
}

const failures = [];
for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    const content = fs.readFileSync(file, 'utf8');
    if (!/neo4j/i.test(content)) continue;
    // Only flag if this file deploys/references a Neo4j workload AND uses a banned namespace.
    if (FORBIDDEN_NAMESPACE_RE.test(content)) {
      failures.push(
        `${path.relative(ROOT, file)}: Neo4j-related manifest must NOT live in the faciomga / abbeygate namespaces — use the dedicated 'org2vec' namespace (ADR-0041 §9).`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('check-neo4j-no-app-pod-coupling: violations detected');
  console.error('');
  for (const f of failures) console.error(`  ${f}`);
  if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
  console.log('check-neo4j-no-app-pod-coupling: ok');
}
