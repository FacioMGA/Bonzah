#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(`[bdx-reset-rerun] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(key, 'true');
      continue;
    }
    args.set(key, next);
    index += 1;
  }
  return args;
}

function requiredArg(args, key) {
  const value = String(args.get(key) || '').trim();
  if (!value) fail(`Missing required argument ${key}`);
  return value;
}

function run(command, env = {}) {
  console.log(`[bdx-reset-rerun] ${command}`);
  execSync(command, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...env,
    },
  });
}

function resolveStageName(templatePath, preferredStageName, fallbackType) {
  const raw = fs.readFileSync(templatePath, 'utf8');
  const template = JSON.parse(raw);
  const stages = Array.isArray(template?.stages) ? template.stages : [];
  if (!stages.length) fail(`Template has no stages: ${templatePath}`);
  const explicit = stages.find((stage) => String(stage?.name || '') === preferredStageName);
  if (explicit) return preferredStageName;
  const bindLike = stages.find((stage) => fallbackType === 'proof'
    ? String(stage?.name || '').toLowerCase().includes('proof') && stage?.dryRun === false
    : String(stage?.name || '').toLowerCase().includes('bind') && stage?.dryRun === false);
  if (bindLike) return String(bindLike.name);
  const firstNonDry = stages.find((stage) => stage?.dryRun === false);
  if (firstNonDry) return String(firstNonDry.name);
  return String(stages[0]?.name || '');
}

const args = parseArgs(process.argv.slice(2));
const allowDestructive = String(process.env.ALLOW_DESTRUCTIVE_BDX_RERUN || '').trim();
if (allowDestructive !== '1' && allowDestructive.toLowerCase() !== 'true') {
  fail('Refusing to run without ALLOW_DESTRUCTIVE_BDX_RERUN=1');
}
if (!String(process.env.DATABASE_URL || '').trim()) {
  fail('DATABASE_URL must be set for the disposable database reset');
}

const sourceFilePath = path.resolve(requiredArg(args, '--source-file'));
if (!fs.existsSync(sourceFilePath)) {
  fail(`Source file does not exist: ${sourceFilePath}`);
}

const proofTemplate = path.resolve(String(args.get('--proof-template') || 'tools/migrations/bdx-proof-batch-template.json'));
if (!fs.existsSync(proofTemplate)) {
  fail(`Proof template does not exist: ${proofTemplate}`);
}

const fullTemplate = path.resolve(String(args.get('--full-template') || 'tmp/bdx-rerun-continue-template.json'));
const endpoint = String(args.get('--endpoint') || process.env.BDX_ENDPOINT || 'http://127.0.0.1:3000/api/policies/imports/bdx').trim();
const proofStage = resolveStageName(proofTemplate, String(args.get('--proof-stage') || 'bindIssue-safe'), 'proof');
const fullStage = resolveStageName(fullTemplate, String(args.get('--full-stage') || 'bindIssue-safe'), 'full');
const skipProof = String(args.get('--skip-proof') || '').toLowerCase() === 'true';
const skipFull = String(args.get('--skip-full') || '').toLowerCase() === 'true';
const authEmail = String(args.get('--auth-email') || process.env.API_SMOKE_EMAIL || 'admin@abbeygate.cy').trim();
const authPassword = String(args.get('--auth-password') || process.env.API_SMOKE_PASSWORD || 'FacioMGA2026').trim();

run('npx prisma db push --force-reset --accept-data-loss');
run('npm run db:seed');
run(`npm run bdx:build-safe-template -- "${sourceFilePath}" "${fullTemplate}" 0 continue`);
run(`npm run bdx:dry-run -- "${sourceFilePath}"`);

if (!skipProof) {
  run(`npx tsx tools/migrations/run_bdx_staged_load.ts "${proofTemplate}" "${proofStage}"`, {
    BDX_UPLOAD_FILE: 'true',
    BDX_ENDPOINT: endpoint,
    API_SMOKE_EMAIL: authEmail,
    API_SMOKE_PASSWORD: authPassword,
  });
}

if (!skipFull) {
  run(`npx tsx tools/migrations/run_bdx_staged_load.ts "${fullTemplate}" "${fullStage}"`, {
    BDX_UPLOAD_FILE: 'true',
    BDX_ENDPOINT: endpoint,
    API_SMOKE_EMAIL: authEmail,
    API_SMOKE_PASSWORD: authPassword,
  });
}

console.log(JSON.stringify({
  sourceFilePath,
  proofTemplate,
  fullTemplate,
  endpoint,
  proofStage,
  fullStage,
  skipProof,
  skipFull,
}, null, 2));
