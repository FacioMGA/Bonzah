#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { highestStableVersion } from './outdated-package-policy-version.mjs';

const ROOT = process.cwd();
const POLICY_PATH = path.join(ROOT, 'tools', 'quality', 'dependency-outdated-policy.json');
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');
const PACKAGE_LOCK_PATH = path.join(ROOT, 'package-lock.json');
const REPORT_PATH = path.join(ROOT, 'artifacts', 'quality', 'dependency-outdated-policy-report.json');

function parseMajor(version) {
  const value = String(version || '').trim();
  const match = value.match(/(\d+)\./);
  if (!match) return null;
  return Number(match[1]);
}

function runOutdatedJson() {
  try {
    const output = execSync('npm outdated --json', { stdio: ['ignore', 'pipe', 'pipe'] });
    return String(output || '').trim();
  } catch (error) {
    return String(error?.stdout || '').trim();
  }
}

function normalizeOutdated(raw) {
  const result = {};
  for (const [pkg, entry] of Object.entries(raw || {})) {
    const first = Array.isArray(entry) ? entry[0] : entry;
    if (!first || typeof first !== 'object') continue;
    result[pkg] = {
      current: String(first.current || ''),
      wanted: String(first.wanted || ''),
      latest: String(first.latest || ''),
    };
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureReportDir() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
}

function readDeprecationMessage(spec) {
  try {
    const output = execFileSync('npm', ['view', spec, 'deprecated', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const raw = String(output || '').trim();
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed.trim() : '';
  } catch {
    return '';
  }
}

function readLatestStableVersion(packageName) {
  try {
    const output = execFileSync('npm', ['view', packageName, 'versions', '--json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(String(output || '[]'));
    const version = highestStableVersion(parsed);
    return version
      ? { version, error: '' }
      : { version: null, error: 'registry returned no stable versions' };
  } catch (error) {
    return {
      version: null,
      error: error instanceof Error ? error.message : 'stable-version registry lookup failed',
    };
  }
}

const policy = readJson(POLICY_PATH);
const pkg = readJson(PACKAGE_JSON_PATH);
const lock = readJson(PACKAGE_LOCK_PATH);
const outdated = normalizeOutdated(JSON.parse(runOutdatedJson() || '{}'));

const directProd = Object.keys(pkg.dependencies || {});
const directDev = Object.keys(pkg.devDependencies || {});
const direct = policy.includeDevDependencies ? [...directProd, ...directDev] : [...directProd];

const lagViolations = [];
const stableLookupViolations = [];
for (const dep of direct) {
  const data = outdated[dep];
  if (!data) continue;
  const currentMajor = parseMajor(data.current);
  let latestForPolicy = data.latest;
  if (data.latest.includes('-')) {
    const lookup = readLatestStableVersion(dep);
    if (!lookup.version) {
      stableLookupViolations.push({ package: dep, reportedLatest: data.latest, error: lookup.error });
      continue;
    }
    latestForPolicy = lookup.version;
  }
  const latestMajor = parseMajor(latestForPolicy);
  if (currentMajor === null || latestMajor === null) continue;
  const lag = latestMajor - currentMajor;
  const maxLag = Number((policy.packageOverrides || {})[dep] ?? policy.maxMajorLag ?? 2);
  if (lag > maxLag) {
    lagViolations.push({
      package: dep,
      current: data.current,
      latest: latestForPolicy,
      majorLag: lag,
      allowedMajorLag: maxLag,
    });
  }
}

const approvedDeprecated = new Set(
  (policy.deprecatedApprovals || [])
    .map((item) => `${String(item.package || '')}@${String(item.version || '')}`)
    .filter(Boolean),
);

const deprecatedViolations = [];
for (const dep of direct) {
  const installedVersion = lock?.packages?.[`node_modules/${dep}`]?.version;
  if (!installedVersion) continue;
  const spec = `${dep}@${installedVersion}`;
  const deprecatedMessage = readDeprecationMessage(spec);
  if (!deprecatedMessage) continue;
  if (approvedDeprecated.has(spec)) continue;
  deprecatedViolations.push({
    package: dep,
    version: installedVersion,
    message: deprecatedMessage,
  });
}

const failures = [];
if (lagViolations.length > 0) failures.push(`major lag policy violations: ${lagViolations.length}`);
if (stableLookupViolations.length > 0) failures.push(`stable-version registry lookup failures: ${stableLookupViolations.length}`);
if (deprecatedViolations.length > 0) failures.push(`deprecated direct dependencies without approval: ${deprecatedViolations.length}`);

ensureReportDir();
fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      policy,
      lagViolations,
      stableLookupViolations,
      deprecatedViolations,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) {
  console.error('[dependency-outdated-policy] failed:');
  for (const item of lagViolations) {
    console.error(
      `- ${item.package}: major lag ${item.majorLag} (current ${item.current}, latest ${item.latest}, allowed ${item.allowedMajorLag})`,
    );
  }
  for (const item of stableLookupViolations) {
    console.error(`- ${item.package}: cannot resolve stable latest behind reported prerelease ${item.reportedLatest}: ${item.error}`);
  }
  for (const item of deprecatedViolations) {
    console.error(`- ${item.package}@${item.version} is deprecated: ${item.message}`);
  }
  console.error(`[dependency-outdated-policy] full report: ${REPORT_PATH}`);
  process.exit(1);
}

console.log('[dependency-outdated-policy] ok');
