#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'backend');
const exts = new Set(['.ts', '.tsx', '.js', '.mjs']);
const LEGACY_DOMAIN_IO_ALLOWLIST = new Set([
]);
const LEGACY_LAYER_EDGE_ALLOWLIST = new Set([
]);

if (LEGACY_DOMAIN_IO_ALLOWLIST.size > 0 || LEGACY_LAYER_EDGE_ALLOWLIST.size > 0) {
  console.error(
    '[backend-layer-imports] allowlists must remain empty; fix offending imports instead of allowlisting.',
  );
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (exts.has(path.extname(ent.name))) out.push(p);
  }
  return out;
}

function read(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function toPosix(p) {
  return p.replaceAll('\\', '/');
}

function layerFromAbs(fileAbs) {
  const rel = toPosix(path.relative(SRC, fileAbs));
  if (rel.includes('/__tests__/') || rel.includes('.test.')) return 'other';
  if (rel.startsWith('core/')) return 'core';
  const mod = rel.match(/^modules\/[^/]+\/(http|app|domain|infra)\//);
  if (mod) return mod[1];
  if (rel.startsWith('api/routes/')) return 'legacy_http';
  return 'other';
}

function moduleFromAbs(fileAbs) {
  const rel = toPosix(path.relative(SRC, fileAbs));
  const mod = rel.match(/^modules\/([^/]+)\/(http|app|domain|infra)\//);
  return mod ? mod[1] : null;
}

function resolveImportToAbs(fromAbs, spec) {
  const s = String(spec || '');
  if (!s) return null;
  if (s.startsWith('.')) {
    const base = path.resolve(path.dirname(fromAbs), s);
    return base;
  }
  if (s.startsWith('@/backend/')) {
    return path.join(ROOT, s.replace('@/backend/', 'backend/'));
  }
  if (s.startsWith('backend/')) {
    return path.join(ROOT, s);
  }
  return null;
}

function violates(fromLayer, toLayer) {
  if (fromLayer === 'core' && ['http', 'app', 'domain', 'infra'].includes(toLayer)) {
    return 'core cannot import modules';
  }
  if (fromLayer === 'http' && (toLayer === 'domain' || toLayer === 'infra')) {
    return 'http cannot import domain/infra (must go through app)';
  }
  if (fromLayer === 'app' && (toLayer === 'http' || toLayer === 'legacy_http')) {
    return 'app cannot import http';
  }
  if (fromLayer === 'domain' && ['infra', 'http', 'legacy_http', 'core'].includes(toLayer)) {
    return 'domain cannot import infra/http/core';
  }
  return null;
}

function violatesDomainPurityBySpecifier(fromLayer, spec) {
  if (fromLayer !== 'domain') return null;
  const s = String(spec || '').toLowerCase();
  const banned = [
    { token: '@prisma/client', reason: 'domain cannot import prisma' },
    { token: '/db/connection', reason: 'domain cannot import db connection' },
    { token: 'express', reason: 'domain cannot import express' },
    { token: '/events/queue', reason: 'domain cannot import queue' },
    { token: '/storage/', reason: 'domain cannot import storage' },
    { token: '/workers/', reason: 'domain cannot import workers' },
  ];
  for (const rule of banned) {
    if (s.includes(rule.token)) return rule.reason;
  }
  return null;
}

const importRe = /from\s+['"]([^'"]+)['"]/g;
const files = walk(SRC);
const failures = [];

for (const file of files) {
  const fromLayer = layerFromAbs(file);
  if (fromLayer === 'other') continue;
  const fromModule = moduleFromAbs(file);
  const isModuleFile = Boolean(fromModule);
  const text = read(file);
  let m;
  while ((m = importRe.exec(text)) !== null) {
    const spec = m[1];
    const toAbsMaybe = resolveImportToAbs(file, spec);
    if (!toAbsMaybe) continue;
    const toLayer = layerFromAbs(toAbsMaybe);
    if (toLayer === 'other') continue;
    const shouldCheckLayer =
      fromLayer === 'core' ||
      (['http', 'app', 'domain', 'infra'].includes(fromLayer) && isModuleFile);
    if (!shouldCheckLayer) continue;
    const reason = violates(fromLayer, toLayer);
    if (reason) {
      const fileRel = toPosix(path.relative(ROOT, file));
      const key = `${fileRel}|${spec}`;
      if (!LEGACY_LAYER_EDGE_ALLOWLIST.has(key)) {
        failures.push(`[${reason}] ${fileRel} -> "${spec}"`);
      }
    }
  }
  importRe.lastIndex = 0;
  while ((m = importRe.exec(text)) !== null) {
    const spec = m[1];
    const fileRel = toPosix(path.relative(ROOT, file));
    if (!isModuleFile || LEGACY_DOMAIN_IO_ALLOWLIST.has(fileRel)) continue;
    const reason = violatesDomainPurityBySpecifier(fromLayer, spec);
    if (reason) {
      failures.push(`[${reason}] ${toPosix(path.relative(ROOT, file))} -> "${spec}"`);
    }
  }
}

if (failures.length) {
  console.error('\nLAYER IMPORT GUARD FAILED:\n' + failures.map((x) => ' - ' + x).join('\n') + '\n');
  process.exit(1);
}

console.log('layer import guard OK');
