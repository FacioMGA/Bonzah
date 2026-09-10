#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const BACKEND_MODULES_DIR = path.join(ROOT, 'backend', 'modules');
const FRONTEND_PRODUCTS_DIR = path.join(ROOT, 'frontend', 'src', 'products');
const SERVER_DIR = path.join(ROOT, 'backend');
const E2E_DIR = path.join(ROOT, 'e2e');
const OUT_DIR = path.join(ROOT, 'artifacts', 'architecture');
const OUT_FILE = path.join(OUT_DIR, 'champs-go-green-baseline.json');

const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TEST_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

function toPosix(p) {
  return p.replaceAll('\\', '/');
}

function rel(p) {
  return toPosix(path.relative(ROOT, p));
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function countLines(p) {
  return read(p).split('\n').length;
}

function isCodeFile(p) {
  return CODE_EXTS.has(path.extname(p));
}

function isTestFile(p) {
  return TEST_RE.test(path.basename(p));
}

function listModuleDirs() {
  return fs
    .readdirSync(BACKEND_MODULES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(BACKEND_MODULES_DIR, e.name))
    .sort();
}

function listProductDirs() {
  return fs
    .readdirSync(FRONTEND_PRODUCTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(FRONTEND_PRODUCTS_DIR, e.name))
    .sort();
}

function moduleBoundaryStats() {
  const dirs = listModuleDirs();
  const withIndex = dirs.filter((d) => fs.existsSync(path.join(d, 'index.ts')));
  return {
    total: dirs.length,
    withIndex: withIndex.length,
    missing: dirs.filter((d) => !withIndex.includes(d)).map(rel),
  };
}

function frontendBoundaryStats() {
  const dirs = listProductDirs();
  const withIndex = dirs.filter((d) => fs.existsSync(path.join(d, 'index.ts')));
  return {
    total: dirs.length,
    withIndex: withIndex.length,
    missing: dirs.filter((d) => !withIndex.includes(d)).map(rel),
  };
}

function domainPurityStats() {
  const all = walk(BACKEND_MODULES_DIR).filter((p) => isCodeFile(p) && rel(p).includes('/domain/'));
  const importedDbRe = /from\s+['"][^'"]*(?:prisma|db(?:\/|\.|['"])|\/db\/)[^'"]*['"]/;
  const prismaTokenRe = /\bPrisma\b|\bprisma\b/;

  const violations = [];
  for (const file of all) {
    const text = read(file);
    if (importedDbRe.test(text) || prismaTokenRe.test(text) && /from\s+['"][^'"]+['"]/.test(text)) {
      violations.push(file);
    }
  }

  return {
    includingTests: violations.map(rel),
    productionOnly: violations.filter((p) => !rel(p).includes('/__tests__/')).map(rel),
  };
}

function reqBodyStats() {
  const files = walk(SERVER_DIR).filter((p) => path.extname(p) === '.ts');
  const allOccurrences = [];
  const unvalidatedHeuristic = [];
  for (const file of files) {
    const lines = read(file).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes('req.body')) continue;
      const lineNo = i + 1;
      allOccurrences.push({ file: rel(file), line: lineNo });

      const from = Math.max(0, i - 12);
      const to = Math.min(lines.length - 1, i + 12);
      const window = lines.slice(from, to + 1).join('\n');
      const hasSchemaSignal =
        /safeParse|parse\(|z\.object|Zod|parseRecord|schema/i.test(window);
      if (!hasSchemaSignal) {
        unvalidatedHeuristic.push({ file: rel(file), line: lineNo });
      }
    }
  }
  return {
    totalReqBodyOccurrences: allOccurrences.length,
    heuristicUnvalidatedOccurrences: unvalidatedHeuristic.length,
    heuristicUnvalidatedSample: unvalidatedHeuristic.slice(0, 40),
  };
}

function testStats() {
  const backend = walk(path.join(ROOT, 'backend')).filter((p) => isTestFile(p)).length;
  const frontend = walk(path.join(ROOT, 'frontend', 'src')).filter((p) => isTestFile(p)).length;
  const e2e = walk(E2E_DIR).filter((p) => isTestFile(p)).length;
  return { backend, frontend, e2e };
}

function anyStats() {
  const files = walk(path.join(ROOT, 'backend')).filter((p) => path.extname(p) === '.ts');
  const re = /:\s*any\b|\bas\s+any\b|<any>/g;
  let count = 0;
  for (const file of files) {
    const text = read(file);
    const matches = text.match(re);
    if (matches) count += matches.length;
  }
  return { explicitAnyCountRegex: count };
}

function largeFileStats() {
  const backendFiles = walk(path.join(ROOT, 'backend')).filter((p) => isCodeFile(p));
  const frontendFiles = walk(path.join(ROOT, 'frontend', 'src')).filter((p) => isCodeFile(p));
  const over = (files) =>
    files
      .map((p) => ({ file: rel(p), loc: countLines(p) }))
      .filter((x) => x.loc > 800)
      .sort((a, b) => b.loc - a.loc);
  return {
    backendOver800: over(backendFiles),
    frontendOver800: over(frontendFiles),
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  moduleBoundaries: moduleBoundaryStats(),
  frontendProductBoundaries: frontendBoundaryStats(),
  domainPurity: domainPurityStats(),
  reqBody: reqBodyStats(),
  tests: testStats(),
  typeSafety: anyStats(),
  largeFiles: largeFileStats(),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`[go-green-baseline] wrote ${rel(OUT_FILE)}`);
