export const ANY_PATTERNS = [
  /\bas any\b/,
  /\bas unknown as\b/,
  /:\s*any\b/,
  /Record<\s*string\s*,\s*any\s*>/,
  /<any>/,
];

// DIFF_ANY_PATTERNS is the broader set used ONLY by check-no-new-any.mjs against
// added (`+`) lines in PR diffs. It deliberately covers the bypass shapes LLMs
// reach for when the narrow ANY_PATTERNS set blocks a literal `any`. Adding
// patterns here does not affect the historical backend ANY_PATTERNS baseline
// (any-baseline.json), which keeps its monotonically-decreasing ceiling.
//
// Bypass classes covered:
//   - Direct any escapes (any[], Array<any>, Promise<any>, Map<any>, etc.)
//   - "Polite any" (Record<string, unknown>, index signatures with any/unknown)
//   - Soft-any casts (`as unknown` alone, `as object`, `as Function`, `as {}`)
//   - `: object` annotation (matches "any non-primitive" — same shrug)
//   - "Compiler shut up" casts (`as never` outside exhaustiveness checks):
//     `expr as never` is the same shrug as `as any` dressed in different
//     clothes — it silences TypeScript instead of expressing a real bridge.
//     Genuine exhaustiveness checks use a parameter-typed `_: never`
//     (declaration shape) or a typed helper like `assertNever(x)` and so do
//     not match `\bas\s+never\b`.
//   - Generic constraint escapes (<T = any>, <T extends any|{}|unknown>)
//   - keyof any
//   - Suppression comments without a FAC ticket
//     (// @ts-ignore, // @ts-nocheck, // @ts-expect-error without FAC-####)
//   - eslint-disable for no-explicit-any / no-unsafe-* / ban-types
export const DIFF_ANY_PATTERNS = [
  /\bas\s+any\b/,
  /\bas\s+unknown\s+as\b/,
  /\bas\s+unknown\s*[);,\]]/,
  /\bas\s+unknown\s*$/,
  /\bas\s+never\b/,
  /\bas\s+Function\b/,
  /\bas\s+\{\s*\}/,
  // `as object` — TypeScript's `object` matches "any non-primitive", which
  // is a similar shrug to `as {}` and `as Function`. The annotation form
  // `: object` is the same hole at a declaration site.
  /\bas\s+object\b/,
  /:\s*object\b/,
  /:\s*any\b/,
  /:\s*Function\b/,
  /\bany\s*\[\s*\]/,
  /\b(?:Array|Promise|Map|Set|ReadonlyArray|Record|Partial|Required|Readonly|Pick|Omit|Awaited|NonNullable)\s*<[^>]*\bany\b[^>]*>/,
  /\bRecord\s*<\s*(?:string|PropertyKey|number|symbol)\s*,\s*unknown\s*>/,
  /\[\s*[A-Za-z_$][\w$]*\s*:\s*(?:string|number|symbol|PropertyKey)\s*\]\s*:\s*(?:any|unknown)\b/,
  /<\s*[A-Za-z_$][\w$]*\s*(?:=|extends)\s*(?:any|unknown)\b/,
  /<\s*[A-Za-z_$][\w$]*\s*(?:=|extends)\s*\{\s*\}/,
  /\bkeyof\s+any\b/,
  /\/\/\s*@ts-(?:ignore|nocheck)\b/,
  /\/\/\s*@ts-expect-error\b(?!.*FAC-\d+)/,
  /eslint-disable[^\n]*\b(?:no-explicit-any|no-unsafe-[a-z-]+|ban-types)\b/,
  /<any>/,
];

// `.d.ts` is included explicitly because ambient declarations are a
// laundering paradise: a single `declare const x: any` propagates the
// unsafe top type across every importer. Note that `path.extname()` and
// `lastIndexOf('.')` both reduce `foo.d.ts` to `.ts`, so existing scanners
// already pick these files up via the `.ts` entry — listing `.d.ts` here
// is documentary and protects against a future scanner that uses a
// stricter (`endsWith`) match instead.
export const SCANNABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.d.ts',
]);

export function hasAnyPattern(text) {
  return ANY_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasDiffAnyPattern(text) {
  return DIFF_ANY_PATTERNS.some((pattern) => pattern.test(text));
}

export function findDiffAnyMatches(text) {
  const hits = [];
  for (const pattern of DIFF_ANY_PATTERNS) {
    if (pattern.test(text)) hits.push(pattern.source);
  }
  return hits;
}

export function countAnyPatternMatches(text) {
  return ANY_PATTERNS.reduce((total, pattern) => {
    const matches = text.match(new RegExp(pattern.source, 'g'));
    return total + (matches ? matches.length : 0);
  }, 0);
}
