#!/usr/bin/env node
import { readChangedNameStatus } from './lib/ci-diff-range.mjs';

function toPosix(p) {
  return String(p || '').replaceAll('\\', '/');
}

const added = readChangedNameStatus()
  .map((entry) => ({ ...entry, file: toPosix(entry.file) }))
  .filter((entry) => entry.status.startsWith('A') || entry.status.startsWith('R'));
const allowedAddedFiles = new Set([]);

function inFrozenRetiredZone(file) {
  return (
    file.startsWith('pages/') ||
    file.startsWith('components/') ||
    file.startsWith('frontend/src/components/') ||
    file.startsWith('frontend/src/features/') ||
    file.startsWith('frontend/src/domains/') ||
    file.startsWith('backend/core/') ||
    file.startsWith('backend/app/') ||
    file.startsWith('backend/domain/') ||
    file.startsWith('backend/services/') ||
    file.startsWith('backend/types/')
  );
}

const failures = added.filter((x) => inFrozenRetiredZone(x.file) && !allowedAddedFiles.has(x.file));

if (failures.length) {
  console.error(
    '\n[retired-zones-guard] New files are not allowed in retired zones:\n' +
      failures.map((x) => ` - ${x.file}`).join('\n') +
      '\n\nMove code into authoritative zones:\n' +
      ' - frontend: frontend/src/surfaces | frontend/src/products | frontend/src/shared\n' +
      ' - backend: backend/modules | backend/platform | backend/http\n',
  );
  process.exit(1);
}

console.log('[retired-zones-guard] ok');
