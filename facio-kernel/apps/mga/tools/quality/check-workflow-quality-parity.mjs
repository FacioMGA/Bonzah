#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const workflowsDir = path.join(ROOT, '.github/workflows');
const expectedWorkflows = [
  'aks-deploy-staging.yml',
  'aks-deploy.yml',
  'azure-images.yml',
  'ci.yml',
  'cursor-autofix-automerge.yml',
];
const retiredWorkflows = [
  'linear-autofix.yml',
  'pr-quality-gate.yml',
  'reusable-quality-gate.yml',
  'azure-deploy.yml',
  'deploy-aks-cy4.yml',
  'codeql.yml',
  'db-reset-and-seed.yml',
  'bdx-corpus-migration.yml',
  'bdx-production-test-rollout.yml',
];
const forbiddenDeployTokens = [
  'npm ci',
  'npx prisma',
  'az postgres',
  'az acr build',
  'backup:posture:check',
  'backup:restore:validate',
  'release:go-no-go-packet',
  'db:audit:runtime-contract',
  'bdx',
  'run_db_reset_seed',
];
const staleReferenceFiles = [
  'docs',
  'tools/quality/README.md',
  'docs/start-here',
  'infrastructure/k8s/helm/abbeygate/values.yaml',
];

function read(file) {
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

const failures = [];

const actualWorkflows = fs
  .readdirSync(workflowsDir)
  .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  .sort();

if (actualWorkflows.join('\n') !== expectedWorkflows.join('\n')) {
  failures.push(`Expected exactly ${expectedWorkflows.join(', ')} in .github/workflows, found ${actualWorkflows.join(', ') || '(none)'}`);
}

for (const file of retiredWorkflows) {
  if (fs.existsSync(path.join(workflowsDir, file))) {
    failures.push(`Retired workflow still exists: .github/workflows/${file}`);
  }
}

const ci = read(path.join(workflowsDir, 'ci.yml'));
const images = read(path.join(workflowsDir, 'azure-images.yml'));
const deploy = read(path.join(workflowsDir, 'aks-deploy.yml'));

if (!ci.includes('npm run gate:ci')) failures.push('ci.yml must run npm run gate:ci');
if (!ci.includes('github/codeql-action/init') || !ci.includes('github/codeql-action/analyze')) {
  failures.push('ci.yml must contain the CodeQL job');
}

for (const token of ['Dockerfile.api', 'Dockerfile.worker', '${GITHUB_SHA}', 'az acr build']) {
  if (!images.includes(token)) failures.push(`azure-images.yml must contain ${token}`);
}

for (const token of ['image_tag', '^[0-9a-f]{40}$', 'az acr repository show', 'helm upgrade', 'rollout status', '/health']) {
  if (!deploy.includes(token)) failures.push(`aks-deploy.yml must contain ${token}`);
}

for (const token of forbiddenDeployTokens) {
  if (deploy.toLowerCase().includes(token.toLowerCase())) {
    failures.push(`aks-deploy.yml contains forbidden hot-path token: ${token}`);
  }
}

for (const file of retiredWorkflows) {
  const token = file;
  for (const rel of staleReferenceFiles) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const paths = fs.statSync(abs).isDirectory()
      ? fs.readdirSync(abs, { recursive: true }).map((entry) => path.join(abs, entry))
      : [abs];
    for (const candidate of paths) {
      if (!fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) continue;
      if (!/\.(md|yaml|yml)$/.test(candidate)) continue;
      const content = read(candidate);
      if (content.includes(token)) {
        failures.push(`${path.relative(ROOT, candidate)} still references retired workflow ${token}`);
      }
    }
  }
}

for (const file of expectedWorkflows) {
  const content = read(path.join(workflowsDir, file));
  if (!content.trim()) {
    failures.push(`Missing workflow: .github/workflows/${file}`);
  }
}

if (failures.length) {
  console.error('[workflow-quality-parity] FAILED');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log('[workflow-quality-parity] OK');
