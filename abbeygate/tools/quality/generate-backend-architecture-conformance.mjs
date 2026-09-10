#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'artifacts', 'architecture');
const OUT_FILE = path.join(OUT_DIR, 'backend-architecture-conformance.json');

function run(command, args) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  return {
    command: [command, ...args].join(' '),
    startedAt,
    exitCode: Number(result.status ?? 1),
    ok: Number(result.status ?? 1) === 0,
    stdout,
    stderr,
  };
}

const checks = [
  run('npm', ['run', 'guard:backend-module-delegation']),
  run('npm', ['run', 'guard:backend-http-boundaries:strict']),
  run('npm', ['run', 'guard:backend-core-business-imports']),
];

const summary = {
  generatedAt: new Date().toISOString(),
  strict: true,
  checks,
  ok: checks.every((check) => check.ok),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(`[backend-architecture-conformance] wrote ${path.relative(ROOT, OUT_FILE)}`);

if (!summary.ok) {
  console.error('[backend-architecture-conformance] one or more checks failed');
  process.exit(1);
}
