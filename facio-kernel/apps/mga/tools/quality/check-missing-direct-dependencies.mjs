#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, 'tools', 'quality', 'dependency-missing-baseline.json');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'quality', 'dependency-missing-report.json');

function runDepcheckJson() {
  try {
    return String(execSync('npx depcheck --json --ignores=k6', { stdio: ['ignore', 'pipe', 'pipe'] })).trim();
  } catch (error) {
    const stdout = String(error?.stdout || '').trim();
    return stdout;
  }
}

function normalizeDepcheckMissing(rawMissing) {
  const entries = [];
  for (const [pkg, files] of Object.entries(rawMissing || {})) {
    const normalizedFiles = Array.isArray(files)
      ? files
          .map((file) => path.relative(ROOT, String(file || '')).replaceAll('\\', '/'))
          .filter(Boolean)
          .sort()
      : [];
    entries.push({
      package: String(pkg),
      files: normalizedFiles,
    });
  }
  return entries.sort((a, b) => a.package.localeCompare(b.package));
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    throw new Error(`Missing baseline file: ${BASELINE_PATH}`);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const known = new Map();
  for (const item of baseline.knownMissing || []) {
    const pkg = String(item?.package || '').trim();
    if (!pkg) continue;
    const files = Array.isArray(item?.files)
      ? item.files.map((f) => String(f || '').replaceAll('\\', '/')).filter(Boolean).sort()
      : [];
    known.set(pkg, new Set(files));
  }
  return known;
}

function ensureReportDir() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
}

const depcheckRaw = runDepcheckJson();
if (!depcheckRaw) {
  throw new Error('depcheck returned no JSON output.');
}

const depcheck = JSON.parse(depcheckRaw);
const normalizedMissing = normalizeDepcheckMissing(depcheck.missing || {});
const baseline = loadBaseline();

const unexpected = [];
for (const item of normalizedMissing) {
  const baselineFiles = baseline.get(item.package) || new Set();
  for (const file of item.files) {
    if (!baselineFiles.has(file)) {
      unexpected.push({ package: item.package, file });
    }
  }
}

ensureReportDir();
fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      missingByPackage: normalizedMissing,
      unexpected,
    },
    null,
    2,
  ),
);

if (unexpected.length > 0) {
  console.error('[dependency-missing] New missing dependencies detected:');
  for (const item of unexpected) {
    console.error(`- ${item.package} in ${item.file}`);
  }
  console.error(`[dependency-missing] full report: ${REPORT_PATH}`);
  process.exit(1);
}

console.log(`[dependency-missing] ok (${normalizedMissing.length} packages, no new missing entries)`);
