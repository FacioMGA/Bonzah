#!/usr/bin/env node
// tools/quality/__tests__/diff-any-patterns.test.mjs
//
// Self-test for the broader DIFF_ANY_PATTERNS set used by check-no-new-any.mjs.
// Locks down both directions — bypass shapes MUST match, and benign code MUST
// NOT match — so a future "cleanup" doesn't silently widen the gap that the
// type-safety ratchet is meant to close.

import { hasDiffAnyPattern, DIFF_ANY_PATTERNS } from '../lib/any-patterns.mjs';

let failures = 0;

function expect(cond, message) {
  if (cond) {
    console.log(`  ok  ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${message}`);
  }
}

const SHOULD_MATCH = [
  // Direct any
  'const x = foo as any;',
  'function f(x: any) {}',
  'const xs: any[] = [];',
  'const ys: Array<any> = [];',
  'const m: Map<string, any> = new Map();',
  'const p: Promise<any> = Promise.resolve(1);',
  'const r: Record<string, any> = {};',
  'function g<T>(): Pick<T, any> { return {} as never; }',
  'type X = keyof any;',
  'const f = <T = any>(x: T) => x;',
  'const f2 = <T extends any>(x: T) => x;',
  'const f3 = <T extends {}>(x: T) => x;',
  'const f4 = <T extends unknown>(x: T) => x;',

  // Polite any
  'const r2: Record<string, unknown> = {};',
  'const r3: Record<PropertyKey, unknown> = {};',
  'interface A { [key: string]: any }',
  'interface B { [k: string]: unknown }',
  'type C = { [idx: number]: any };',

  // Soft-any casts
  'const x = foo as unknown;',
  'const x = (foo as unknown);',
  'const x = foo as unknown as Bar;',
  'const x = foo as Function;',
  'const x = foo as {};',

  // "Compiler shut up" cast — same shrug as `as any`, just dressed differently.
  // Genuine exhaustiveness uses a parameter-typed `_: never` or an
  // `assertNever(x)` helper (covered by SHOULD_NOT_MATCH below) and so does
  // not match this pattern.
  'await handler(req as never, res as never, next);',
  'return foo as never;',
  'const x = (foo as never);',

  // `as object` / `: object` — `object` is "any non-primitive", a similar
  // shrug to `as {}` and `as Function` at a different syntactic position.
  'const x = foo as object;',
  'function f(x: object) {}',
  'const r: { meta: object } = { meta: {} };',

  // Function type
  'const fn: Function = () => {};',

  // Suppression comments
  '// @ts-ignore',
  '// @ts-nocheck',
  '// @ts-expect-error something broke',
  '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
  '// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment',
  '// eslint-disable-next-line @typescript-eslint/ban-types',
];

const SHOULD_NOT_MATCH = [
  // Comments and strings that mention "any" without using it as a type
  '// describe what any of these inputs do',
  'const message = "expected any of: [a, b, c]";',
  'const url = "/api/v1/anything";',

  // Legitimate non-any annotations
  'function f(x: string) {}',
  'const xs: string[] = [];',
  'const r: Record<string, string> = {};',
  'const p: Promise<User> = getUser();',
  'type X = keyof User;',

  // Generic with constraint that is not any/{}/unknown
  'const f = <T extends User>(x: T) => x;',
  'const f = <T extends Record<string, string>>(x: T) => x;',

  // ts-expect-error WITH a FAC ticket — escape hatch is honoured
  '// @ts-expect-error FAC-1234 owner=team expires=2026-12-31 deletionPR=#9999 reason: third-party type bug',

  // eslint-disable for unrelated rules
  '// eslint-disable-next-line no-console',
  '// eslint-disable-next-line import/no-cycle',

  // Empty interface declaration (legitimate)
  'interface Marker {}',

  // `as const` — not an any cast
  'const xs = [1, 2, 3] as const;',

  // Genuine exhaustiveness checks — declaration shape, not the cast shape.
  // These are the only legitimate uses of `never` and they MUST stay green.
  'function assertNever(_: never): never { throw new Error("unreachable"); }',
  'const _exhaustive: never = value;',
  'export function exhaustive(_: never) {}',
];

console.log(`Loaded ${DIFF_ANY_PATTERNS.length} DIFF_ANY_PATTERNS.\n`);

console.log('Lines that MUST match (bypass shapes):');
for (const line of SHOULD_MATCH) {
  expect(hasDiffAnyPattern(line), `match: ${line}`);
}

console.log('\nLines that MUST NOT match (benign code / honoured escape hatches):');
for (const line of SHOULD_NOT_MATCH) {
  expect(!hasDiffAnyPattern(line), `no match: ${line}`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll DIFF_ANY_PATTERNS assertions passed.');
