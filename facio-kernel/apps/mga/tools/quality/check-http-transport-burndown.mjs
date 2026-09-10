#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, 'docs', 'architecture', 'baselines', 'backend-http-burndown-baseline.json');
const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cursor', '.vscode', 'tools', 'docs', 'artifacts']);
const SCAN_ROOTS = ['backend', 'frontend/src', 'apps'];
const TOKEN = 'backend/http/';

function toPosix(value) {
  return String(value || '').replaceAll('\\', '/');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(abs));
      continue;
    }
    if (SCANNABLE_EXTENSIONS.has(path.extname(entry.name))) out.push(abs);
  }
  return out;
}

function countToken(text, token) {
  if (!text.includes(token)) return 0;
  return text.split(token).length - 1;
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(`[http-transport-burndown] missing baseline file: ${toPosix(path.relative(ROOT, BASELINE_PATH))}`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
const maxBackendHttpReferences = Number(baseline.maxBackendHttpReferences || 0);

const files = SCAN_ROOTS.flatMap((relRoot) => walk(path.join(ROOT, relRoot)));
let current = 0;
for (const file of files) {
  const rel = toPosix(path.relative(ROOT, file));
  if (rel === toPosix(path.relative(ROOT, BASELINE_PATH))) continue;
  const text = fs.readFileSync(file, 'utf8');
  current += countToken(text, TOKEN);
}

if (current > maxBackendHttpReferences) {
  console.error(
    `[http-transport-burndown] FAILED: backend/http references increased (${current} > ${maxBackendHttpReferences}).`,
  );
  process.exit(1);
}

const delta = maxBackendHttpReferences - current;
console.log(
  `[http-transport-burndown] OK: current=${current}, baseline=${maxBackendHttpReferences}, reduced_by=${delta}`,
);
