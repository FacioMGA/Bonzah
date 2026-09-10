#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const BASELINE_PATH = path.join(ROOT, 'tools', 'quality', 'dependency-duplication-baseline.json');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'quality', 'dependency-duplication-report.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadTree() {
  // Exclude optional dependencies to avoid platform-specific drift noise
  // (e.g. native/optional packages that differ between runner OS images).
  const output = execSync('npm ls --all --omit=optional --json', {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 200 * 1024 * 1024,
  });
  return JSON.parse(String(output));
}

function analyzeTree(tree) {
  const versionsByPackage = new Map();
  let maxDepth = 0;
  let packageNodes = 0;

  function walk(node, depth) {
    if (!node || typeof node !== 'object') return;
    maxDepth = Math.max(maxDepth, depth);
    for (const [name, dep] of Object.entries(node.dependencies || {})) {
      packageNodes += 1;
      const version = String(dep?.version || '(missing)');
      if (!versionsByPackage.has(name)) versionsByPackage.set(name, new Set());
      versionsByPackage.get(name).add(version);
      walk(dep, depth + 1);
    }
  }

  walk(tree, 0);

  const multiVersionPackages = [...versionsByPackage.entries()]
    .filter(([, versions]) => versions.size > 1)
    .map(([name, versions]) => ({ name, count: versions.size, versions: [...versions].sort() }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    packageNodes,
    uniquePackages: versionsByPackage.size,
    maxDepth,
    multiVersionPackages,
  };
}

function ensureReportDir() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
}

const baseline = loadJson(BASELINE_PATH);
const analysis = analyzeTree(loadTree());

const allowedDepth = Number(baseline.maxDepth || 0) + Number(baseline.allowedDepthIncrease || 0);
const allowedMulti = Number(baseline.maxMultiVersionPackages || 0) + Number(baseline.allowedMultiVersionIncrease || 0);
const failures = [];

if (analysis.maxDepth > allowedDepth) {
  failures.push(`max depth regression: ${analysis.maxDepth} > ${allowedDepth}`);
}

if (analysis.multiVersionPackages.length > allowedMulti) {
  failures.push(`multi-version package regression: ${analysis.multiVersionPackages.length} > ${allowedMulti}`);
}

for (const [pkg, allowedVersions] of Object.entries(baseline.watchedPackages || {})) {
  const current = analysis.multiVersionPackages.find((item) => item.name === pkg)?.count || 1;
  if (current > Number(allowedVersions)) {
    failures.push(`watched package '${pkg}' has ${current} versions (allowed ${allowedVersions})`);
  }
}

ensureReportDir();
fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      summary: {
        packageNodes: analysis.packageNodes,
        uniquePackages: analysis.uniquePackages,
        maxDepth: analysis.maxDepth,
        multiVersionPackages: analysis.multiVersionPackages.length,
      },
      topMultiVersionPackages: analysis.multiVersionPackages.slice(0, 40),
      baseline,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) {
  console.error('[dependency-duplication] drift detected:');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`[dependency-duplication] full report: ${REPORT_PATH}`);
  process.exit(1);
}

console.log(
  `[dependency-duplication] ok (depth=${analysis.maxDepth}, multiVersion=${analysis.multiVersionPackages.length})`,
);
