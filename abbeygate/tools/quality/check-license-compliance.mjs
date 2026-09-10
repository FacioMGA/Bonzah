#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const POLICY_PATH = path.join(ROOT, 'tools', 'quality', 'license-policy.json');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'quality', 'license-compliance-report.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureReportDir() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
}

function packageNameFromLockKey(key) {
  const marker = 'node_modules/';
  const idx = key.lastIndexOf(marker);
  if (idx < 0) return null;
  const tail = key.slice(idx + marker.length);
  return tail || null;
}

function isDenied(license, deniedSubstrings) {
  const normalized = String(license || '').toUpperCase().replace(/[()]/g, '').trim();
  if (!normalized) return null;

  const tokens = normalized.split(/\s+OR\s+/i).map((x) => x.trim()).filter(Boolean);
  const deniedMatches = tokens.map((token) =>
    deniedSubstrings.find((needle) => token.includes(String(needle).toUpperCase())) || null,
  );

  if (tokens.length > 1) {
    const hasPermissiveAlternative = deniedMatches.some((match) => match === null);
    if (hasPermissiveAlternative) return null;
  }

  const joinedMatch = deniedSubstrings.find((token) => normalized.includes(String(token).toUpperCase())) || null;
  return joinedMatch;
}

const policy = readJson(POLICY_PATH);
const lock = readJson(LOCK_PATH);
const deniedSubstrings = Array.isArray(policy.deniedLicenseSubstrings) ? policy.deniedLicenseSubstrings : [];
const allowUnknown = new Set((policy.allowUnknownPackages || []).map((x) => String(x)));
const allowDenied = new Set(
  (policy.allowDeniedPackages || [])
    .map((x) => `${String(x.package || '')}@${String(x.version || '')}`)
    .filter(Boolean),
);

const licenseCounts = new Map();
const unknownViolations = [];
const deniedViolations = [];

for (const [key, value] of Object.entries(lock.packages || {})) {
  if (!key.startsWith('node_modules/')) continue;
  const pkg = packageNameFromLockKey(key);
  if (!pkg) continue;
  const version = String(value?.version || '');
  if (!version) continue;
  const id = `${pkg}@${version}`;
  const license = String(value?.license || '').trim();
  if (!license) {
    if (!allowUnknown.has(pkg)) unknownViolations.push({ package: pkg, version });
    continue;
  }
  licenseCounts.set(license, (licenseCounts.get(license) || 0) + 1);
  const deniedMatch = isDenied(license, deniedSubstrings);
  if (deniedMatch && !allowDenied.has(id)) {
    deniedViolations.push({ package: pkg, version, license, deniedBy: deniedMatch });
  }
}

const topLicenses = [...licenseCounts.entries()]
  .map(([license, count]) => ({ license, count }))
  .sort((a, b) => b.count - a.count || a.license.localeCompare(b.license))
  .slice(0, 30);

const failures = [];
if (unknownViolations.length > 0) failures.push(`unknown license entries: ${unknownViolations.length}`);
if (deniedViolations.length > 0) failures.push(`denied license entries: ${deniedViolations.length}`);

ensureReportDir();
fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      policy,
      topLicenses,
      unknownViolations,
      deniedViolations,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) {
  console.error('[license-compliance] failed:');
  for (const item of unknownViolations.slice(0, 30)) {
    console.error(`- unknown license: ${item.package}@${item.version}`);
  }
  if (unknownViolations.length > 30) {
    console.error(`- ... ${unknownViolations.length - 30} more unknown-license entries`);
  }
  for (const item of deniedViolations.slice(0, 30)) {
    console.error(`- denied license (${item.deniedBy}): ${item.package}@${item.version} => ${item.license}`);
  }
  if (deniedViolations.length > 30) {
    console.error(`- ... ${deniedViolations.length - 30} more denied-license entries`);
  }
  console.error(`[license-compliance] full report: ${REPORT_PATH}`);
  process.exit(1);
}

console.log('[license-compliance] ok');
