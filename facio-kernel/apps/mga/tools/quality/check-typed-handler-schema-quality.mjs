#!/usr/bin/env node
// tools/quality/check-typed-handler-schema-quality.mjs
//
// Schema-honesty fence for ADR-0028's `typedHandler(schemas, handler)`.
//
// `check-http-handler-typing.mjs` blocks net-new BARE Express handler
// signatures. That stops the obvious bypass — but a "compliant but
// fake" usage is still possible:
//
//   typedHandler({ body: z.any() },              async (req) => …)
//   typedHandler({ body: z.unknown() },          async (req) => …)
//   typedHandler({ body: z.record(z.unknown()) }, async (req) => …)
//   typedHandler({ body: z.object({}).passthrough() },  async (req) => …)
//   typedHandler({ body: z.object({}).catchall(z.unknown()) }, async (req) => …)
//   typedHandler({},                             async (req) => req.body)  // no body schema declared, yet read raw
//
// Each of those satisfies the wrapper's signature while preserving
// "unknown soup" — the original problem rebadged. This guard scans
// the repo for those exact shapes.
//
// Repo-wide enforcement (NOT diff-only) because a weak schema today is
// indistinguishable from a weak schema introduced last quarter; the
// migration waves under ADR-0028 must land real schemas, not the
// permissive shapes above.
//
// Three rules enforced:
//   R1 — banned-shape rule:
//        Inside a `typedHandler(SCHEMAS, …)` first argument, none of
//        the banned Zod shapes may appear. The list is the catalogue
//        above. The exception is `z.unknown()` used as the inner
//        validator for `z.record(z.unknown())` — the whole expression
//        is banned, not just the inner.
//   R2 — body-required rule:
//        If a `typedHandler({…}, handler)` call's first argument does
//        NOT declare a `body:` schema, the handler's parameter list
//        must not read `req.body` / `request.body`. (Reading `params`
//        or `query` without a schema is fine — Express types them
//        narrowly to `ParamsDictionary` / `ParsedQs`.)
//   R3 — blessed-cast rule:
//        `as TypedRequest<…>` is allowed ONLY in the wrapper itself
//        (`backend/platform/http/typedHandler.ts`). The cast exists
//        because TypeScript cannot resolve the wrapper's conditional
//        type at the assignment site; reproducing it elsewhere would
//        re-introduce the laundering pattern the wrapper is paid to
//        prevent.
//
// Self-skip: the wrapper itself, the wrapper's tests, this guard, and
// `*.test.ts` / `__tests__/` (test fixtures may legitimately exercise
// the wrapper with a permissive schema to verify error paths).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SCAN_ROOT = path.join(REPO_ROOT, 'backend');
const SCAN_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

const WRAPPER_FILE = 'backend/platform/http/typedHandler.ts';
const WRAPPER_TEST_FILE = 'backend/platform/http/__tests__/typedHandler.test.ts';
const SELF_SKIP = new Set([WRAPPER_FILE, WRAPPER_TEST_FILE]);

const ALLOW_TAG = /TODO\(FAC-\d+\):(?=.*\bowner=[^\s]+)(?=.*\bexpires=[^\s]+)(?=.*\bdeletionPR=[^\s]+).+/;

const BANNED_SHAPES = [
    // `z.any()` — the literal "anything goes" Zod node. Always wrong inside
    // a typedHandler schema.
    { name: 'z.any()', rx: /\bz\s*\.\s*any\s*\(\s*\)/ },
    // `z.unknown()` — same hole as `z.any()` once handed to a downstream
    // consumer that can't refine it. Banning the standalone form transitively
    // covers `z.record(z.unknown())` and `z.array(z.unknown())` too.
    { name: 'z.unknown()', rx: /\bz\s*\.\s*unknown\s*\(\s*\)/ },
    // `.passthrough()` — preserves unknown extra keys at the type level.
    // Always wrong on a request boundary; if the route is genuinely
    // open-ended, narrow it once with a discriminated union instead.
    { name: '.passthrough()', rx: /\.\s*passthrough\s*\(\s*\)/ },
    // `.catchall(...)` — same trap, even when the inner validator is narrow:
    // the schema admits arbitrary extra keys instead of rejecting them.
    // Allowing this would make the wrapper a "compliant but fake" laundry.
    { name: '.catchall(...)', rx: /\.\s*catchall\s*\(/ },
];

const TYPED_REQUEST_CAST_RX = /\bas\s+TypedRequest\s*</;

function listFiles(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFiles(full));
        else if (SCAN_EXTS.has(path.extname(entry.name))) out.push(full);
    }
    return out;
}

function rel(p) {
    return path.relative(REPO_ROOT, p).replaceAll('\\', '/');
}

// Skip line-comments and block-comments before scanning a span. Tests in
// __tests__/ are also skipped because fixtures may legitimately exercise
// permissive schemas to check error paths.
function isTestPath(relPath) {
    return relPath.includes('/__tests__/') || /\.test\.tsx?$/.test(relPath);
}

// Strip TS line- and block-comments. Quoted strings stay intact so that
// a banned shape buried inside a string literal is still flagged (we want
// to catch `eval`-style dynamic-schema sources too — defensive belt).
function stripComments(text) {
    let out = '';
    let i = 0;
    let inString = false;
    let stringQuote = '';
    let escape = false;
    while (i < text.length) {
        const c = text[i];
        const next = text[i + 1];
        if (inString) {
            out += c;
            if (escape) escape = false;
            else if (c === '\\') escape = true;
            else if (c === stringQuote) inString = false;
            i += 1;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            inString = true;
            stringQuote = c;
            out += c;
            i += 1;
            continue;
        }
        if (c === '/' && next === '/') {
            while (i < text.length && text[i] !== '\n') i += 1;
            continue;
        }
        if (c === '/' && next === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
            i += 2;
            continue;
        }
        out += c;
        i += 1;
    }
    return out;
}

// Find every `typedHandler(` call, returning an array of
// `{ start, schemaStart, schemaEnd, handlerStart, handlerEnd }` index
// ranges into the (comment-stripped) source text.
function findTypedHandlerCalls(text) {
    const calls = [];
    const callRx = /\btypedHandler\s*\(/g;
    let m;
    while ((m = callRx.exec(text)) !== null) {
        const open = text.indexOf('(', m.index + 'typedHandler'.length);
        if (open < 0) continue;
        // First argument should be `{...}` (the schema object literal).
        let i = open + 1;
        while (i < text.length && /\s/.test(text[i])) i += 1;
        if (text[i] !== '{') continue;
        const schemaStart = i;
        let depth = 1;
        i += 1;
        while (i < text.length && depth > 0) {
            const ch = text[i];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            i += 1;
        }
        if (depth !== 0) continue;
        const schemaEnd = i; // exclusive of closing brace handled inside loop
        // Skip whitespace + comma, then capture the second argument span up to the
        // matching close-paren of the call.
        while (i < text.length && /[\s,]/.test(text[i])) i += 1;
        const handlerStart = i;
        let parenDepth = 1;
        let inString = false;
        let stringQuote = '';
        let escape = false;
        while (i < text.length && parenDepth > 0) {
            const ch = text[i];
            if (inString) {
                if (escape) escape = false;
                else if (ch === '\\') escape = true;
                else if (ch === stringQuote) inString = false;
            } else if (ch === '"' || ch === "'" || ch === '`') {
                inString = true;
                stringQuote = ch;
            } else if (ch === '(') parenDepth += 1;
            else if (ch === ')') parenDepth -= 1;
            i += 1;
        }
        if (parenDepth !== 0) continue;
        const handlerEnd = i; // exclusive of closing paren
        calls.push({
            start: m.index,
            schemaStart,
            schemaEnd,
            handlerStart,
            handlerEnd,
            schemaText: text.slice(schemaStart, schemaEnd),
            handlerText: text.slice(handlerStart, handlerEnd),
        });
    }
    return calls;
}

function checkBannedShapes(call, relPath, lineForOffset) {
    const failures = [];
    for (const shape of BANNED_SHAPES) {
        const local = new RegExp(shape.rx.source, shape.rx.flags.includes('g') ? shape.rx.flags : `${shape.rx.flags}g`);
        let m;
        while ((m = local.exec(call.schemaText)) !== null) {
            const absOffset = call.schemaStart + m.index;
            const lineNo = lineForOffset(absOffset);
            const snippet = call.schemaText
                .slice(Math.max(0, m.index - 20), Math.min(call.schemaText.length, m.index + 80))
                .replaceAll('\n', ' ')
                .trim();
            failures.push(
                `${relPath}:${lineNo}: typedHandler schema uses banned shape \`${shape.name}\` — ` +
                `compliant signature, unknown soup inside. Replace with an explicit business ` +
                `schema. Snippet: …${snippet}…`,
            );
        }
    }
    return failures;
}

function checkBodyRequired(call, relPath, lineForOffset) {
    const failures = [];
    const declaresBody = /\bbody\s*:/.test(call.schemaText);
    if (declaresBody) return failures;
    // No `body:` schema. Now look in the handler arg span for `req.body` / `request.body`.
    const bodyAccessRx = /\b(?:req|request)\s*\.\s*body\b/g;
    let m;
    while ((m = bodyAccessRx.exec(call.handlerText)) !== null) {
        const absOffset = call.handlerStart + m.index;
        const lineNo = lineForOffset(absOffset);
        failures.push(
            `${relPath}:${lineNo}: typedHandler({...}) declares no \`body:\` schema yet the inner ` +
            `handler reads \`${m[0]}\`. Either add a \`body: <Schema>\` to the schemas object so the ` +
            `body is parsed and narrowed, or remove the body access. Defaulting to the unsafe top ` +
            `type defeats the wrapper's purpose.`,
        );
    }
    return failures;
}

function buildLineLookup(text) {
    const offsets = [0];
    for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') offsets.push(i + 1);
    return (offset) => {
        let lo = 0;
        let hi = offsets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (offsets[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return lo + 1;
    };
}

function main() {
    const failures = [];
    const files = listFiles(SCAN_ROOT);

    for (const file of files) {
        const relPath = rel(file);
        const original = fs.readFileSync(file, 'utf8');
        const text = stripComments(original);

        // R3 — blessed-cast rule (everywhere except the wrapper itself).
        if (!SELF_SKIP.has(relPath)) {
            const lineLookup = buildLineLookup(original);
            const castRx = new RegExp(TYPED_REQUEST_CAST_RX.source, 'g');
            let cm;
            while ((cm = castRx.exec(text)) !== null) {
                // Re-find in the original text to get the real line number, allowing
                // the FAC-tag escape hatch.
                const sliceStart = Math.max(0, cm.index - 200);
                const beforeOffsetInSlice = cm.index - sliceStart;
                const slice = original.slice(sliceStart, sliceStart + beforeOffsetInSlice + 200);
                const lineStart = slice.lastIndexOf('\n', beforeOffsetInSlice) + 1;
                const lineEnd = slice.indexOf('\n', beforeOffsetInSlice);
                const lineText = slice.slice(lineStart, lineEnd === -1 ? slice.length : lineEnd);
                if (ALLOW_TAG.test(lineText)) continue;
                failures.push(
                    `${relPath}:${lineLookup(cm.index)}: \`as TypedRequest<…>\` is the wrapper's ` +
                    `blessed cast (used inside \`typedHandler\` to bridge TypeScript's conditional ` +
                    `type resolution gap). Reproducing it outside ${WRAPPER_FILE} re-introduces the ` +
                    `laundering pattern the wrapper exists to prevent. Use \`typedHandler(schemas, handler)\` ` +
                    `instead — the inner handler argument is already typed as \`TypedRequest<typeof schemas>\`.`,
                );
            }
        }

        // R1 + R2 — typedHandler call-site rules.
        if (isTestPath(relPath) || SELF_SKIP.has(relPath)) continue;
        const calls = findTypedHandlerCalls(text);
        if (calls.length === 0) continue;
        const lineLookup = buildLineLookup(text);
        for (const call of calls) {
            failures.push(...checkBannedShapes(call, relPath, lineLookup));
            failures.push(...checkBodyRequired(call, relPath, lineLookup));
        }
    }

    if (failures.length > 0) {
        console.error('[typed-handler-schema-quality] FAILED:');
        for (const f of failures) console.error(`  - ${f}`);
        console.error(
            `\nADR-0028 (\`docs/architecture/decisions/ADR-0028-typed-http-handler-wrapper.md\`)` +
            `\nis explicit: \`typedHandler\` is the boundary parser, not a laundering ritual. The` +
            `\nbanned shapes above (\`z.any()\`, \`z.unknown()\`, \`z.record(z.unknown())\`,` +
            `\n\`.passthrough()\`, \`.catchall(...)\`) all preserve unknown soup while satisfying the` +
            `\nwrapper's signature. Replace them with explicit business schemas; if a field genuinely` +
            `\ncarries arbitrary JSON, narrow it once with a discriminated union or document the` +
            `\nexception with a TODO(FAC-####): owner=… expires=… deletionPR=… reason annotation.`,
        );
        process.exit(1);
    }

    console.log(`[typed-handler-schema-quality] OK — scanned ${files.length} backend file(s).`);
}

main();
