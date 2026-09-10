#!/usr/bin/env node
/**
 * ABY-97 follow-up — Event-routing / handler-registration parity guard.
 *
 * The bug this guard pins: PR6 (`106b63a2`) deleted the exact routing
 * branch for `COMM.OUTBOUND_QUEUED` AND its handler registration, on
 * the basis of a flawed "zero enqueues in 14 days" production audit
 * (the audit window coincided with the broken doc-gen pipeline, which
 * suppressed every welcome-email enqueue). The producers
 * (`communicationsService.createMessage`, BO send-* routes) all still
 * emitted `COMM.OUTBOUND_QUEUED` — so every welcome / quote / UW /
 * payment-request email since PR6 enqueued silently and never
 * delivered.
 *
 * The structural invariant this guard enforces:
 *
 *   For every literal eventType in a `eventType === '<X>'` exact-match
 *   branch in `routeEventToQueue` (queue.ts), there MUST be a matching
 *   `registerHandler('<X>', ...)` somewhere under
 *   `backend/workers/handlers/`.
 *
 * That is: if queue.ts knows the name `X`, the handler registry MUST
 * too — and vice versa. We do NOT require every handler to appear in
 * routing because the `dataSync` default-queue catches the rest and
 * its worker still does `getHandler(job.name)`. We DO require every
 * deliberately-routed name to land somewhere — that's the half PR6
 * broke (kept routing for one name, dropped handler for the other,
 * left an orphan).
 *
 * Prefix routing rules (`eventType.startsWith('FOO.')`) are fan-out
 * and not checked: many handlers may consume `EMAIL.*` and listing
 * each by name in queue.ts would defeat the prefix.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const QUEUE_FILE = path.join(ROOT, 'backend/platform/events/queue.ts');
const HANDLERS_DIR = path.join(ROOT, 'backend/workers/handlers');

function* walkTs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkTs(full);
    else if (entry.isFile() && entry.name.endsWith('.ts')) yield full;
  }
}

function parseRoutingRules() {
  const text = fs.readFileSync(QUEUE_FILE, 'utf8');
  const exact = new Set();
  const prefixes = [];
  let m;
  const exactRe = /eventType\s*===\s*['"]([A-Z][A-Z0-9._]*?)['"]/g;
  while ((m = exactRe.exec(text)) !== null) exact.add(m[1]);
  const prefRe = /eventType\.startsWith\(\s*['"]([A-Z0-9._]*?\.)['"]\s*\)/g;
  while ((m = prefRe.exec(text)) !== null) prefixes.push(m[1]);
  return { exact, prefixes };
}

function discoverRegisteredHandlerNames() {
  const names = new Map();
  if (!fs.existsSync(HANDLERS_DIR)) return names;
  const re = /registerHandler\(\s*['"]([A-Z][A-Z0-9._]*?)['"]/g;
  for (const file of walkTs(HANDLERS_DIR)) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!names.has(m[1])) names.set(m[1], []);
      names.get(m[1]).push(path.relative(ROOT, file));
    }
  }
  return names;
}

function main() {
  const rules = parseRoutingRules();
  const handlers = discoverRegisteredHandlerNames();

  // For every exact routing branch in queue.ts there MUST be a matching
  // registerHandler() call. Prefix rules are fan-out and not checked.
  const exactRouteNoHandler = [];
  for (const eventType of rules.exact) {
    if (!handlers.has(eventType)) {
      exactRouteNoHandler.push(eventType);
    }
  }

  if (exactRouteNoHandler.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[event-routing-parity] ok (${rules.exact.size} exact routing branches; every one has a matching registerHandler())`,
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.error('\n[event-routing-parity] FAIL: queue.ts <> workers/handlers desync.\n');
  // eslint-disable-next-line no-console
  console.error('  Exact routing branches in queue.ts with NO matching registerHandler() in backend/workers/handlers/:');
  for (const t of exactRouteNoHandler.sort()) {
    // eslint-disable-next-line no-console
    console.error(`    - ${t}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix: either add the missing handler registration, or drop the orphan exact-match branch from `routeEventToQueue` (queue.ts).\n' +
      'Why this matters: silent-enqueue / never-deliver bugs are nearly invisible to operators (no exception in the producer, just an unprocessed job in the wrong queue). PR6 of the cleanup program (`106b63a2`) is the canonical example — every welcome email broke for ~14 days before anyone noticed.\n',
  );
  process.exit(1);
}

main();
