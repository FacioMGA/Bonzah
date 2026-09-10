#!/usr/bin/env node
// tools/quality/check-http-handler-typing.mjs
//
// Diff-only guard for ADR-0028 — typed HTTP handler wrapper.
//
// Per the canonical-ownership row "HTTP boundary input parsing
// wrapper", every NEW route handler authored in `backend/**/http/**`
// (or `backend/products/*/quotes/controller*.ts`) must go through
// `backend/platform/http/typedHandler.ts` rather than re-rolling
// `(req: Request, res: Response) => …` shapes that re-launder
// `req.body` / `req.params` / `req.query` field-by-field. The wrapper
// parametrizes Express's `Request` with caller-supplied Zod schemas
// at the boundary so the 270 resolved-any sites the compiler walk
// found at `Request<P, ResB, ReqB, Q>` defaults can drop.
//
// Existing handlers stay on the resolved-any baseline ratchet
// (`tools/quality/any-resolved-baseline.json`, lower-only); this guard
// is intentionally diff-only so the landing PR doesn't try to migrate
// 270 sites in one go. Migration waves drop the baseline; this guard
// prevents the baseline from being regressed by net-new bypasses.
//
// Failing patterns on a `+` line under a route-handler path:
//   - `(req: Request,` / `(req: Request)` — a bare `Request` parameter
//     (no generics) in an arrow or function expression.
//   - `: RequestHandler` without generics — likewise drops the
//     parametrization the wrapper exists to add.
//
// Allowed forms:
//   - `typedHandler(schemas, async (req, res) => …)` — the canonical path.
//   - `typedHandler(schemas, async (req: TypedRequest<typeof schemas>, …))` — explicit but parametrized.
//   - `Request<P, ResB, ReqB, Q>` with explicit generics — bypassing the wrapper but at least narrowing each slot.
//   - Lines tagged with `TODO(FAC-####): owner=… expires=… deletionPR=… reason` — the
//     existing exception convention used by `check-no-new-any.mjs`.
//
// Self-skip:
//   - The wrapper itself (`backend/platform/http/typedHandler.ts`) and
//     its tests legitimately mention bare `Request` to declare the
//     wrapper's outer signature.
//   - Test files (`__tests__/`, `*.test.ts`) — fixture mocks of `req` are
//     fine.
//   - Existing middleware files (`*middleware*.ts`) — middleware is not a
//     route handler and bare `Request` is its idiomatic shape.

import { readUnifiedDiff } from './lib/ci-diff-range.mjs';

const ALLOW_TAG = /TODO\(FAC-\d+\):(?=.*\bowner=[^\s]+)(?=.*\bexpires=[^\s]+)(?=.*\bdeletionPR=[^\s]+).+/;

const HANDLER_PATH_PATTERNS = [
    /^backend\/[^/]+\/http\//,
    /^backend\/modules\/[^/]+\/http\//,
    /^backend\/platform\/[^/]+\/http\//,
    /^backend\/products\/[^/]+\/quotes\/controller/,
];

const SELF_SKIP_PATHS = [
    'backend/platform/http/typedHandler.ts',
];

const SKIP_FILE_PATTERNS = [
    /\/__tests__\//,
    /\.test\.tsx?$/,
    /[Mm]iddleware\.ts$/,
];

// `(req: Request,` or `(req: Request)` — bare param without generics.
// Excludes `Request<…>` and `RequestHandler` (handled separately).
const BARE_REQUEST_RX = /\(\s*(?:req|request)\s*:\s*Request(?!\w|<)/;

// `: RequestHandler` without generics.
const BARE_REQUEST_HANDLER_RX = /:\s*RequestHandler(?!\w|<)/;

function isHandlerFile(file) {
    return HANDLER_PATH_PATTERNS.some((rx) => rx.test(file));
}

function isSkipped(file) {
    if (SELF_SKIP_PATHS.includes(file)) return true;
    return SKIP_FILE_PATTERNS.some((rx) => rx.test(file));
}

function main() {
    const diff = readUnifiedDiff();
    const lines = diff.split('\n');

    let file = '';
    const offenders = [];

    for (const line of lines) {
        if (line.startsWith('+++ b/')) {
            file = line.slice('+++ b/'.length);
            continue;
        }
        if (!file || !isHandlerFile(file) || isSkipped(file)) continue;
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        if (ALLOW_TAG.test(line)) continue;

        const matched = [];
        if (BARE_REQUEST_RX.test(line)) matched.push('bare Request param without generics');
        if (BARE_REQUEST_HANDLER_RX.test(line)) matched.push('bare RequestHandler without generics');
        if (matched.length > 0) {
            offenders.push({ file, line: line.slice(1).trim(), matched });
        }
    }

    if (offenders.length > 0) {
        console.error(`HTTP handler typing guard failed: ${offenders.length} new bare-Request handler signature(s) introduced.\n`);
        for (const offender of offenders) {
            console.error(`- ${offender.file}: ${offender.line}`);
            console.error(`    matched: ${offender.matched.join(' | ')}`);
        }
        console.error(
            '\nWrap new handlers via the canonical typed wrapper:',
            '\n  import { typedHandler } from \'backend/platform/http/typedHandler\';',
            '\n  router.post(\'/path\', typedHandler({ body: BodySchema }, async (req, res) => { … }));',
            '\nSee ADR-0028 (`docs/architecture/decisions/ADR-0028-typed-http-handler-wrapper.md`)',
            '\nfor the contract. If the bypass is unavoidable, annotate the same line with',
            '\n  TODO(FAC-####): owner=<team> expires=<condition/date> deletionPR=<target> <reason>',
            '\nand `check-any-exceptions` will accept it.',
        );
        process.exit(1);
    }

    console.log('HTTP handler typing guard passed: no new bare-Request handler signatures in diff.');
}

main();
