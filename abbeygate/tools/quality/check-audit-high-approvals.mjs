#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(`[audit-high-approvals] ${message}`);
  process.exit(1);
}

function readAuditReport() {
  try {
    const output = execSync('npm audit --json --audit-level=high', {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return JSON.parse(output);
  } catch (error) {
    const stdout = String(error?.stdout || '').trim();
    if (!stdout) {
      throw error;
    }
    return JSON.parse(stdout);
  }
}

function loadApprovals() {
  const approvalsPath = path.resolve(process.cwd(), '.security/audit-high-approvals.json');
  if (!fs.existsSync(approvalsPath)) {
    fail(`Missing approvals file at ${approvalsPath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(approvalsPath, 'utf8'));
  const approvals = Array.isArray(parsed?.approvals) ? parsed.approvals : [];
  const byPackage = new Map();
  for (const approval of approvals) {
    const pkg = String(approval?.package || '').trim();
    if (!pkg) continue;
    byPackage.set(pkg, {
      advisorySources: new Set((approval?.advisorySources || []).map((x) => Number(x)).filter(Number.isFinite)),
      expiresOn: String(approval?.expiresOn || ''),
      owner: String(approval?.owner || ''),
      reason: String(approval?.reason || ''),
    });
  }
  return byPackage;
}

function isExpired(dateStr) {
  const d = new Date(`${dateStr}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) || Date.now() > d.getTime();
}

const report = readAuditReport();
const approvals = loadApprovals();
const vulnerabilities = report?.vulnerabilities || {};
const failures = [];

for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
  const severity = String(vuln?.severity || '').toLowerCase();
  if (severity !== 'high' && severity !== 'critical') continue;
  const approval = approvals.get(pkgName);
  if (!approval) {
    failures.push(`Missing approval for high/critical package '${pkgName}'`);
    continue;
  }
  if (isExpired(approval.expiresOn)) {
    failures.push(`Approval for '${pkgName}' is expired (expiresOn=${approval.expiresOn})`);
    continue;
  }
  const advisorySources = (vuln?.via || [])
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => Number(entry.source))
    .filter(Number.isFinite);
  for (const source of advisorySources) {
    if (!approval.advisorySources.has(source)) {
      failures.push(`Unapproved advisory source ${source} for package '${pkgName}'`);
    }
  }
}

if (failures.length > 0) {
  console.error('[audit-high-approvals] Unapproved high vulnerabilities detected:');
  for (const line of failures) console.error(`- ${line}`);
  process.exit(1);
}

console.log('[audit-high-approvals] ok');
