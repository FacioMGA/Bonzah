#!/usr/bin/env node
/**
 * CHAMPS guard — no MCP tool executes a Cypher string sourced from
 * `arguments` (ADR-0041 §7 / Forbidden list).
 *
 * Pins:
 *   - No file under `backend/modules/operator/app/` may contain
 *     `session.run(input.…)` / `session.run(arguments.…)` / `session.run(args.…)`.
 *   - No `operator.*` tool descriptor may pass user-supplied strings
 *     into a Cypher executor.
 *
 * The forbidden tools (`operator.run_cypher`, `operator.query_neo4j`)
 * are explicitly banned for V1 and forever.
 */
import fs from 'node:fs';
import path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const SCAN_ROOT = path.join(ROOT, 'backend/modules/operator');

// session.run(<identifier-or-property-access-not-quoted-string>) - flag.
// Cypher strings should be loaded from `.cypher` files via the repository.
const FORBIDDEN_TOOL_NAMES = /name:\s*['"](?:operator\.run_cypher|operator\.query_neo4j|operator\.cypher)['"]/;
const FORBIDDEN_INPUT_CYPHER = /session\.run\s*\(\s*(?:input|args|arguments|payload|req\.body)/;

function walk(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'dist') continue;
      results = results.concat(walk(p));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(p);
    }
  }
  return results;
}

const failures = [];
for (const file of walk(SCAN_ROOT)) {
  const content = fs.readFileSync(file, 'utf8');
  if (FORBIDDEN_TOOL_NAMES.test(content)) {
    failures.push(`${path.relative(ROOT, file)}: declares a forbidden raw-Cypher tool name (ADR-0041 Forbidden).`);
  }
  if (FORBIDDEN_INPUT_CYPHER.test(content)) {
    failures.push(`${path.relative(ROOT, file)}: passes input-derived Cypher into session.run (ADR-0041 Forbidden).`);
  }
}

if (failures.length > 0) {
  console.error('check-no-raw-cypher-mcp-tool: violations detected');
  console.error('');
  for (const f of failures) console.error(`  ${f}`);
  if (STRICT) process.exit(1);
}

if (STRICT && failures.length === 0) {
  console.log('check-no-raw-cypher-mcp-tool: ok');
}
