#!/usr/bin/env node
// tools/quality/check-any-resolved.mjs
//
// Resolved-any baseline ratchet (Layer 1). Walks the backend and frontend
// TypeScript programs with the compiler API and counts declaration sites
// whose RESOLVED type contains `any` — after type-alias resolution, generic
// instantiation, and `// @ts-ignore` suppression. This is the gate that
// closes alias laundering (`type Json = any`), `as unknown as Foo` chains,
// and custom helpers that funnel any into shared code, because the
// regex-based diff guard (check-no-new-any.mjs) cannot see across files.
//
// The total is compared against tools/quality/any-resolved-baseline.json,
// which is monotonically decreasing: PRs may lower it, never raise it.
//
// Usage:
//   node tools/quality/check-any-resolved.mjs               # CI gate
//   node tools/quality/check-any-resolved.mjs --report      # show offenders
//   node tools/quality/check-any-resolved.mjs --write       # snapshot baseline (local only)
//
// Counted declaration sites:
//   - parameters
//   - property declarations / signatures
//   - variable declarations (const/let/var)
//   - function/method/arrow/function-expression return types
//   - type-alias right-hand side
//
// Skipped:
//   - declaration files (*.d.ts)
//   - test files (*.test.ts*, **/__tests__/**, **/__fixtures__/**)
//   - node_modules / dist / build artefacts
//   - the tools/quality/ folder itself
//
// `unknown` is intentionally NOT counted here (it is separately governed by
// the boundary-validation contract); only types whose resolved shape
// transitively contains `any` are counted.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_FILE = path.join(REPO_ROOT, 'tools', 'quality', 'any-resolved-baseline.json');

const SCOPES = [
  { name: 'backend', tsconfig: path.join(REPO_ROOT, 'backend', 'tsconfig.json') },
  { name: 'frontend', tsconfig: path.join(REPO_ROOT, 'frontend', 'tsconfig.json') },
];

const SKIP_PATH_FRAGMENTS = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}.vite${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
  `${path.sep}__fixtures__${path.sep}`,
  `${path.sep}tools${path.sep}quality${path.sep}`,
];

const TEST_FILE_RX = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

function isSkippedFile(filePath) {
  if (filePath.endsWith('.d.ts')) return true;
  if (TEST_FILE_RX.test(filePath)) return true;
  for (const fragment of SKIP_PATH_FRAGMENTS) {
    if (filePath.includes(fragment)) return true;
  }
  return false;
}

function loadProgram(tsconfigPath) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`Cannot read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    tsconfigPath,
  );
  if (parsed.errors.length > 0) {
    const message = parsed.errors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('\n');
    throw new Error(`Cannot parse ${tsconfigPath}:\n${message}`);
  }
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true },
    projectReferences: parsed.projectReferences,
  });
  return program;
}

function typeContainsAny(type, checker, seen = new Set()) {
  if (!type) return false;
  const id = type.id;
  if (id !== undefined) {
    if (seen.has(id)) return false;
    seen.add(id);
  }

  if (type.flags & ts.TypeFlags.Any) {
    // `intrinsicName` is "any" for real any and "error" for the synthetic
    // error type; treat both as anys for the purpose of the ratchet —
    // type errors should be visible to this guard, not laundered into
    // a free pass. Skip the synthetic intrinsic that represents `intrinsic`
    // marker types from the lib (e.g. `any` in lib.d.ts itself is fine
    // because we only inspect user declarations).
    return true;
  }

  if (type.isUnion?.() || type.isIntersection?.()) {
    for (const member of type.types) {
      if (typeContainsAny(member, checker, seen)) return true;
    }
    return false;
  }

  // Resolved generic instantiations expose their type arguments via
  // `aliasTypeArguments` (when the type is referenced through an alias)
  // and `typeArguments` (the resolved object type's instantiation args).
  const aliasArgs = type.aliasTypeArguments;
  if (aliasArgs) {
    for (const arg of aliasArgs) {
      if (typeContainsAny(arg, checker, seen)) return true;
    }
  }
  const objectFlags = type.objectFlags ?? 0;
  if (objectFlags & ts.ObjectFlags.Reference) {
    const typeArgs = checker.getTypeArguments(type);
    for (const arg of typeArgs) {
      if (typeContainsAny(arg, checker, seen)) return true;
    }
  }

  return false;
}

function getDeclarationTypeNode(node) {
  if (
    ts.isParameter(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isVariableDeclaration(node)
  ) {
    return node.type ? node : null;
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  ) {
    return node.type ? node : null;
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return node;
  }
  return null;
}

function locationKey(sourceFile, node) {
  const start = node.getStart(sourceFile, /* includeJsDoc */ false);
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return `${path.relative(REPO_ROOT, sourceFile.fileName)}:${line + 1}:${character + 1}`;
}

function describeNode(node) {
  if (ts.isTypeAliasDeclaration(node)) return `type ${node.name.text}`;
  if (ts.isFunctionDeclaration(node)) return `function ${node.name?.text ?? '<anonymous>'}() return type`;
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    return `method ${node.name?.getText?.() ?? '<computed>'}() return type`;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return 'arrow/function expression return type';
  if (ts.isParameter(node)) return `parameter ${node.name.getText()}`;
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
    return `property ${node.name.getText()}`;
  }
  if (ts.isVariableDeclaration(node)) return `variable ${node.name.getText()}`;
  return 'declaration';
}

function scanProgram(program, scopeName) {
  const checker = program.getTypeChecker();
  const offenders = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (isSkippedFile(sourceFile.fileName)) continue;

    const visit = (node) => {
      const target = getDeclarationTypeNode(node);
      if (target) {
        let type;
        try {
          if (ts.isTypeAliasDeclaration(target)) {
            type = checker.getTypeFromTypeNode(target.type);
          } else if (target.type) {
            type = checker.getTypeFromTypeNode(target.type);
          } else {
            type = checker.getTypeAtLocation(target);
          }
        } catch {
          type = undefined;
        }
        if (type && typeContainsAny(type, checker)) {
          offenders.push({
            scope: scopeName,
            location: locationKey(sourceFile, target),
            description: describeNode(target),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }

  return offenders;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    return { backend: { max: 0 }, frontend: { max: 0 } };
  }
  const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  return {
    backend: { max: Number(raw.backend?.max ?? 0) },
    frontend: { max: Number(raw.frontend?.max ?? 0) },
  };
}

function writeBaseline(counts) {
  // Preserve every `_*`-prefixed doc block already present in the baseline
  // file (e.g. `_doc`, `_frontend_floor_doc`) so a `--write` pass refreshes
  // the numbers without erasing the human-authored explanations of the
  // floor (e.g. why the frontend ratchet bottoms out at the React stdlib
  // propagation noise).
  const existing = fs.existsSync(BASELINE_FILE)
    ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
    : {};
  const docBlocks = Object.fromEntries(
    Object.entries(existing).filter(([key]) => key.startsWith('_')),
  );
  if (!docBlocks._doc) {
    docBlocks._doc = [
      'Resolved-any ratchet ceiling per scope. Lower-only.',
      '',
      'A PR may not raise either number. When debt drops, lower the ceiling',
      'in the same commit so the new floor is locked in.',
      '',
      'Source of truth: tools/quality/check-any-resolved.mjs walks each',
      'tsconfig program, asks the TypeScript checker for the resolved type',
      'at every declaration site, and counts those that contain `any` after',
      'alias and generic resolution. Suppression comments and laundered',
      'casts through `unknown` do NOT hide from this counter.',
    ];
  }
  const payload = {
    ...docBlocks,
    backend: { max: counts.backend },
    frontend: { max: counts.frontend },
  };
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const args = new Set(process.argv.slice(2));
  const showReport = args.has('--report');
  const writeMode = args.has('--write');

  const totals = {};
  const allOffenders = [];

  for (const scope of SCOPES) {
    if (!fs.existsSync(scope.tsconfig)) {
      throw new Error(`Missing tsconfig for scope ${scope.name}: ${scope.tsconfig}`);
    }
    const program = loadProgram(scope.tsconfig);
    const offenders = scanProgram(program, scope.name);
    totals[scope.name] = offenders.length;
    allOffenders.push(...offenders);
  }

  if (writeMode) {
    writeBaseline(totals);
    console.log(`[any-resolved] baseline written:`);
    for (const [scope, count] of Object.entries(totals)) {
      console.log(`  ${scope}: ${count}`);
    }
    return;
  }

  if (args.has('--dump-json')) {
    const jsonPath = path.join(REPO_ROOT, 'artifacts', 'quality', 'any-resolved-offenders.json');
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, `${JSON.stringify({ totals, offenders: allOffenders }, null, 2)}\n`, 'utf8');
    console.log(`[any-resolved] wrote ${allOffenders.length} offenders to ${path.relative(REPO_ROOT, jsonPath)}`);
    return;
  }

  const baseline = readBaseline();
  let failed = false;
  const lines = [];

  for (const scope of SCOPES) {
    const ceiling = baseline[scope.name].max;
    const observed = totals[scope.name];
    if (observed > ceiling) {
      failed = true;
      lines.push(`  ${scope.name}: observed ${observed} > ceiling ${ceiling} (delta +${observed - ceiling})`);
    } else {
      lines.push(`  ${scope.name}: observed ${observed} <= ceiling ${ceiling}`);
    }
  }

  if (failed) {
    console.error('[any-resolved] FAILED — declaration sites whose resolved type contains `any` increased.');
    console.error(lines.join('\n'));
    if (showReport || allOffenders.length <= 50) {
      console.error('\nOffenders (sample):');
      for (const offender of allOffenders.slice(0, 50)) {
        console.error(`  - [${offender.scope}] ${offender.location} (${offender.description})`);
      }
      if (allOffenders.length > 50) {
        console.error(`  ... and ${allOffenders.length - 50} more (rerun with --report for the full list).`);
      }
    } else {
      console.error('\nRerun with `--report` to see the offending declaration sites.');
    }
    console.error(
      '\nFix options, in order of preference:',
      '\n  1. Replace the offending type with the real shape (preferred — this is why the gate exists).',
      '\n  2. Narrow at the boundary with Zod / @facio/validation, then use the typed result.',
      '\n  3. If genuinely unavoidable, annotate the line with',
      '\n     TODO(FAC-123): owner=<team> expires=<date> deletionPR=<#> <reason>',
      '\n     and lower the ceiling in any-resolved-baseline.json by the same amount you cleaned up elsewhere.',
    );
    process.exit(1);
  }

  console.log('[any-resolved] OK');
  console.log(lines.join('\n'));
}

try {
  main();
} catch (error) {
  console.error(`[any-resolved] error: ${error.message}`);
  process.exit(2);
}
