#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LEDGER_PATH = path.join(ROOT, 'tools', 'quality', 'exception-deletion-ledger.json');
const REQUIRED_FIELDS = ['id', 'source', 'owner', 'expiryCondition', 'deletionPrTarget'];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const parsed = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
const exceptions = Array.isArray(parsed.exceptions) ? parsed.exceptions : [];
const failures = [];
const seen = new Set();
const emptyState = parsed.emptyState;

for (const [index, entry] of exceptions.entries()) {
  const label = nonEmptyString(entry?.id) ? entry.id : `entry[${index}]`;
  for (const field of REQUIRED_FIELDS) {
    if (!nonEmptyString(entry?.[field])) failures.push(`${label}: missing ${field}`);
  }
  if (nonEmptyString(entry?.id)) {
    if (seen.has(entry.id)) failures.push(`${label}: duplicate id`);
    seen.add(entry.id);
  }
}

if (exceptions.length === 0) {
  if (!emptyState || typeof emptyState !== 'object') {
    failures.push('ledger has no exceptions; add explicit emptyState with owner, reason, and reviewedAt');
  } else {
    for (const field of ['owner', 'reason', 'reviewedAt']) {
      if (!nonEmptyString(emptyState[field])) failures.push(`emptyState: missing ${field}`);
    }
  }
}

if (failures.length > 0) {
  console.error('[exception-deletion-ledger] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`[exception-deletion-ledger] OK (${exceptions.length} exception(s) tracked)`);
