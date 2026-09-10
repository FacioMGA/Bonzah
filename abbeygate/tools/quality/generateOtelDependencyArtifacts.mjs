#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const BASELINES_DIR = path.join(ROOT, 'docs', 'architecture', 'baselines');
const JSON_OUT = path.join(BASELINES_DIR, 'otel-dependency-baseline.json');
const MD_OUT = path.join(BASELINES_DIR, 'otel-dependency-baseline.md');

function runNpmTree() {
  const raw = execSync('npm ls --all --json', {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 200 * 1024 * 1024,
  });
  return JSON.parse(String(raw));
}

function hasOtel(node) {
  if (!node || typeof node !== 'object' || !node.dependencies) return false;
  for (const [name, dep] of Object.entries(node.dependencies)) {
    if (name.startsWith('@opentelemetry/')) return true;
    if (hasOtel(dep)) return true;
  }
  return false;
}

function collectOtel(node, versionsByPackage, edges, parentName) {
  if (!node || typeof node !== 'object' || !node.dependencies) return;
  for (const [name, dep] of Object.entries(node.dependencies)) {
    const version = String(dep?.version || 'missing');
    if (name.startsWith('@opentelemetry/')) {
      if (!versionsByPackage.has(name)) versionsByPackage.set(name, new Set());
      versionsByPackage.get(name).add(version);
      edges.push({ parent: parentName, package: name, version });
    }
    collectOtel(dep, versionsByPackage, edges, name);
  }
}

function summarize(tree) {
  const versionsByPackage = new Map();
  const edges = [];
  collectOtel(tree, versionsByPackage, edges, tree.name || 'root');

  const packages = [...versionsByPackage.entries()]
    .map(([name, versions]) => ({
      name,
      versions: [...versions].sort(),
      versionCount: versions.size,
    }))
    .sort((a, b) => b.versionCount - a.versionCount || a.name.localeCompare(b.name));

  const roots = [];
  for (const [name, dep] of Object.entries(tree.dependencies || {})) {
    if (!hasOtel(dep)) continue;
    const localMap = new Map();
    const localEdges = [];
    collectOtel(dep, localMap, localEdges, name);
    roots.push({
      rootPackage: name,
      otelPackages: [...localMap.entries()]
        .map(([pkg, versions]) => ({
          name: pkg,
          versions: [...versions].sort(),
          versionCount: versions.size,
        }))
        .sort((a, b) => b.versionCount - a.versionCount || a.name.localeCompare(b.name)),
    });
  }
  roots.sort((a, b) => a.rootPackage.localeCompare(b.rootPackage));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      packageCount: packages.length,
      multiVersionCount: packages.filter((p) => p.versionCount > 1).length,
    },
    packages,
    roots,
    edges,
  };
}

function markdownReport(report) {
  const lines = [];
  lines.push('# OpenTelemetry Dependency Baseline');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- OTel packages: ${report.summary.packageCount}`);
  lines.push(`- Multi-version OTel packages: ${report.summary.multiVersionCount}`);
  lines.push('');
  lines.push('## Multi-version packages');
  lines.push('');
  const multi = report.packages.filter((p) => p.versionCount > 1);
  if (multi.length === 0) {
    lines.push('- None');
  } else {
    for (const item of multi) {
      lines.push(`- ${item.name}: ${item.versions.join(', ')}`);
    }
  }
  lines.push('');
  lines.push('## Top-level sources');
  lines.push('');
  for (const root of report.roots) {
    lines.push(`- ${root.rootPackage}: ${root.otelPackages.length} OTel packages`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

fs.mkdirSync(BASELINES_DIR, { recursive: true });
const report = summarize(runNpmTree());
fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
fs.writeFileSync(MD_OUT, markdownReport(report));
console.log(`[otel-baseline] wrote ${path.relative(ROOT, JSON_OUT)} and ${path.relative(ROOT, MD_OUT)}`);
