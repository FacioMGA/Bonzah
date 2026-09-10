#!/usr/bin/env node
import { readChangedNameStatus } from './lib/ci-diff-range.mjs';

const added = readChangedNameStatus()
  .filter((entry) => entry.status === 'A')
  .map((entry) => String(entry.file))
  .filter((file) => file.startsWith('backend/services/'));

if (added.length > 0) {
  console.error('\n[services-freeze] FAILED\n');
  for (const file of added) {
    console.error(` - new file in deprecated services zone: ${file}`);
  }
  console.error('\nCreate new backend behavior under backend/modules/* instead.\n');
  process.exit(1);
}

console.log('[services-freeze] OK');
