#!/usr/bin/env node
/**
 * Sentry-wiring guard.
 *
 * Why this guard exists:
 * Both Sentry projects (`abbeygate` and `abbeygate-react`) sat at zero
 * events for an extended period because three independent footguns lined
 * up — and any of them silently no-op'd Sentry without leaving evidence
 * in the build or in pod logs:
 *
 *   1. The K8s runtime secret was missing the `SENTRY_DSN` key, and the
 *      Helm chart treated it as `optionalSecretKeys`, so the env var
 *      was simply absent and `Sentry.init()` no-op'd in silence.
 *   2. `Sentry.init()` lived inside an exported function called *after*
 *      `import` statements for express/prisma/applicationinsights ran.
 *      ESM hoists imports, so init never ran early enough for Sentry's
 *      OTel auto-instrumentation to patch the http stack.
 *   3. Nothing in CI, in `/health/integrations`, or in the deploy smoke
 *      step would catch any of the above.
 *
 * This guard pins the structural contract that fixes (2) and the Helm
 * placement that fixes (1). It does NOT and cannot verify the actual
 * K8s secret content from CI — that is what `/health/integrations`
 * (curled by the AKS deploy smoke step) is for.
 *
 * Rules enforced:
 *   A. `backend/platform/observability/instrument.ts` exists and calls
 *      `Sentry.init(` at module top-level (i.e. NOT inside an exported
 *      function — that was the original bug).
 *   B. `backend/index.ts`, `backend/worker.ts`, `apps/api/index.ts`,
 *      and `apps/worker/index.ts` import the instrument as their FIRST
 *      import (otherwise auto-instrumentation cannot patch).
 *   C. `backend/platform/config/integrationHealth.ts` lists `'sentry'`
 *      as an integration with `SENTRY_DSN` in its envVars and
 *      `isProd()` as the `isRequired` predicate — so a missing DSN in
 *      production is reported by `/health/integrations`.
 *   D. `infrastructure/k8s/helm/abbeygate/values.yaml` has
 *      `SENTRY_DSN: SENTRY_DSN` under `secretKeys:` (required), NOT
 *      under `optionalSecretKeys:` (the original silent-no-op trap).
 *   E. `.github/workflows/azure-images.yml` enforces `VITE_SENTRY_DSN`
 *      at frontend build time (a missing build-arg there is what would
 *      cause `abbeygate-react` to ship without a DSN baked in).
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const errors = [];
function fail(msg) {
  errors.push(msg);
}

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    fail(`Required file is missing: ${rel}`);
    return null;
  }
  return fs.readFileSync(abs, 'utf8');
}

// Rule A — instrument.ts exists and calls Sentry.init at top-level.
const INSTRUMENT_PATH = 'backend/platform/observability/instrument.ts';
const instrument = read(INSTRUMENT_PATH);
if (instrument) {
  if (!/Sentry\.init\(/.test(instrument)) {
    fail(`${INSTRUMENT_PATH} must call Sentry.init(...). The whole point of this file is the pre-import side effect.`);
  }
  // Reject the pattern where Sentry.init is wrapped in an `export
  // function ...` — that recreates the original bug because callers
  // would have to invoke the function from a body line, which ESM
  // schedules after every import.
  if (/export\s+(async\s+)?function[^()]*\([^)]*\)\s*[:{]/.test(instrument)
      && !/^\(function\s+\w+\s*\(\)\s*:\s*void\s*\{[\s\S]+\}\)\(\);/m.test(instrument)) {
    fail(
      `${INSTRUMENT_PATH} must run Sentry.init at module top-level (an IIFE is fine). ` +
        `Wrapping init in an exported function brings back the ESM-hoist bug — ` +
        `imports for express/prisma will already have evaluated by the time the call runs.`,
    );
  }
}

// Rule B — every entrypoint imports instrument as the FIRST import.
const ENTRYPOINTS = [
  'backend/index.ts',
  'backend/worker.ts',
  'apps/api/index.ts',
  'apps/worker/index.ts',
];

const INSTRUMENT_IMPORT_PATTERNS = [
  /import\s+['"]\.\/platform\/observability\/instrument\.js['"]/, // backend/*.ts
  /import\s+['"]\.\.\/\.\.\/backend\/platform\/observability\/instrument\.js['"]/, // apps/*/index.ts
];

for (const entry of ENTRYPOINTS) {
  const text = read(entry);
  if (!text) continue;
  const lines = text.split('\n');
  // Find the first non-comment, non-blank line.
  let firstImportLine = null;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    firstImportLine = trimmed;
    break;
  }
  if (!firstImportLine) {
    fail(`${entry}: could not locate the first non-comment line.`);
    continue;
  }
  const matches = INSTRUMENT_IMPORT_PATTERNS.some((re) => re.test(firstImportLine));
  if (!matches) {
    fail(
      `${entry}: the first import MUST be the Sentry instrument ` +
        `(\`./platform/observability/instrument.js\` or \`../../backend/platform/observability/instrument.js\`). ` +
        `Found: ${firstImportLine}. ` +
        `If anything else loads first, ESM evaluates that subtree before Sentry.init runs.`,
    );
  }
}

// Rule C — integrationHealth registers Sentry as a required-in-prod integration.
const INTEGRATION_HEALTH_PATH = 'backend/platform/config/integrationHealth.ts';
const integrationHealth = read(INTEGRATION_HEALTH_PATH);
if (integrationHealth) {
  const sentryBlockRe = /id:\s*'sentry'[\s\S]*?envVars:\s*\[[^\]]*'SENTRY_DSN'[^\]]*\][\s\S]*?isRequired:\s*\(\)\s*=>\s*isProd\(\)/m;
  if (!sentryBlockRe.test(integrationHealth)) {
    fail(
      `${INTEGRATION_HEALTH_PATH} must register Sentry: ` +
        `\`{ id: 'sentry', envVars: [..., 'SENTRY_DSN', ...], isRequired: () => isProd() }\`. ` +
        `Without this row, /health/integrations cannot tell ops that Sentry is dark.`,
    );
  }
}

// Rule D — Helm values lists SENTRY_DSN under secretKeys (not optionalSecretKeys).
const VALUES_PATH = 'infrastructure/k8s/helm/abbeygate/values.yaml';
const values = read(VALUES_PATH);
if (values) {
  const lines = values.split('\n');
  // Identify section starts. The two relevant blocks both live under
  // `runtimeConfig:`. We do a simple scan for the section headers and
  // then look for `SENTRY_DSN:` indented under each.
  let inRequired = false;
  let inOptional = false;
  let foundInRequired = false;
  let foundInOptional = false;
  for (const rawLine of lines) {
    if (/^\s*secretKeys:\s*$/.test(rawLine)) {
      inRequired = true;
      inOptional = false;
      continue;
    }
    if (/^\s*optionalSecretKeys:\s*$/.test(rawLine)) {
      inRequired = false;
      inOptional = true;
      continue;
    }
    // A new top-level-of-runtimeConfig key (less indentation than 4
    // spaces) ends both sections.
    if (/^[a-zA-Z]/.test(rawLine) || /^\s{0,2}[a-zA-Z]/.test(rawLine)) {
      // Actually any new key at the same indent as `secretKeys` ends
      // the block. Reset on lines that look like `  someKey:` (two
      // spaces).
      if (/^\s{0,2}[a-zA-Z][a-zA-Z0-9_]*:\s*/.test(rawLine)) {
        inRequired = false;
        inOptional = false;
      }
    }
    if (/^\s+SENTRY_DSN:\s*SENTRY_DSN/.test(rawLine)) {
      if (inRequired) foundInRequired = true;
      if (inOptional) foundInOptional = true;
    }
  }
  if (foundInOptional) {
    fail(
      `${VALUES_PATH}: \`SENTRY_DSN\` must NOT be under \`optionalSecretKeys\`. ` +
        `That placement is exactly what made backend Sentry silently no-op when the K8s ` +
        `secret omitted the key. Move it to \`secretKeys\`.`,
    );
  }
  if (!foundInRequired) {
    fail(
      `${VALUES_PATH}: \`SENTRY_DSN: SENTRY_DSN\` must appear under \`secretKeys:\` ` +
        `(required, not optional) so the pod fails to start when the K8s secret omits it.`,
    );
  }
}

// Rule E — azure-images.yml fails the build if VITE_SENTRY_DSN is empty.
const AZURE_IMAGES_PATH = '.github/workflows/azure-images.yml';
const azureImages = read(AZURE_IMAGES_PATH);
if (azureImages) {
  const guardsBuild = /if\s*\[\s*-z\s+"\$\{VITE_SENTRY_DSN:-\}"\s*\]/.test(azureImages);
  const passesArg = /--build-arg\s+"VITE_SENTRY_DSN=\$\{VITE_SENTRY_DSN\}"/.test(azureImages);
  if (!guardsBuild) {
    fail(
      `${AZURE_IMAGES_PATH}: must guard \`if [ -z "\${VITE_SENTRY_DSN:-}" ]\` and exit 1 ` +
        `for the API image. Without it, the frontend bundle can ship without Sentry.`,
    );
  }
  if (!passesArg) {
    fail(
      `${AZURE_IMAGES_PATH}: must pass \`--build-arg "VITE_SENTRY_DSN=\${VITE_SENTRY_DSN}"\` ` +
        `to the API image build.`,
    );
  }
}

if (errors.length > 0) {
  console.error('Sentry wiring guard failed:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('Sentry wiring OK.');
