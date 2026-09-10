#!/usr/bin/env node
/**
 * ADR-0017 / ABY-97 — Dockerfile asset-parity guard.
 *
 * The bug this guard pins: `Dockerfile.api` and `Dockerfile.worker`
 * BOTH need the same set of runtime asset COPYs (templates + static
 * PDFs + pricing data) because the worker pod is what actually
 * renders policy documents — yet the two files drifted silently. The
 * API image had every required HOME asset; the worker image only had
 * motor templates. Both Dockerfiles built and deployed cleanly, but
 * every HOME issuance failed inside the worker because the templates
 * and static PDFs were not in the worker container's filesystem.
 *
 * The asymmetry was undetectable until a customer paid and the
 * doc-pack worker threw ENOENT. This guard makes it CI-detectable
 * before merge.
 *
 * Rule: every `COPY ... ./backend/dist/products/<X>/documents/<dir>`
 * or `COPY ... ./backend/dist/products/<X>/pricing/data` line that
 * appears in EITHER Dockerfile MUST appear in the other. Order doesn't
 * matter; presence does.
 *
 * Pricing data and email templates are intentionally in scope because
 * the worker also reads them (premium recalc on endorsement, welcome
 * email rendering).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const API_DOCKERFILE = path.join(ROOT, 'infrastructure/docker/Dockerfile.api');
const WORKER_DOCKERFILE = path.join(ROOT, 'infrastructure/docker/Dockerfile.worker');

const RUNTIME_ASSET_PATTERN = /\.\/backend\/dist\/products\/[^\s\\]+\/(documents\/(templates|static)|pricing\/data)/g;

function extractRuntimeAssetTargets(dockerfile) {
  if (!fs.existsSync(dockerfile)) {
    throw new Error(`Dockerfile not found: ${dockerfile}`);
  }
  const text = fs.readFileSync(dockerfile, 'utf8');
  const targets = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('COPY ')) continue;
    const matches = trimmed.match(RUNTIME_ASSET_PATTERN);
    if (!matches) continue;
    for (const m of matches) {
      // Normalise to the dist-relative path so `./backend/dist/products/home/documents/static`
      // collapses to a single comparable token.
      targets.add(m.replace(/^\.\//, ''));
    }
  }
  return targets;
}

function diffSets(a, b) {
  const onlyInA = [...a].filter((x) => !b.has(x)).sort();
  const onlyInB = [...b].filter((x) => !a.has(x)).sort();
  return { onlyInA, onlyInB };
}

function main() {
  const apiTargets = extractRuntimeAssetTargets(API_DOCKERFILE);
  const workerTargets = extractRuntimeAssetTargets(WORKER_DOCKERFILE);
  const { onlyInA, onlyInB } = diffSets(apiTargets, workerTargets);

  if (onlyInA.length === 0 && onlyInB.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[docker-asset-parity] ok (${apiTargets.size} runtime asset targets in both Dockerfiles)`);
    return;
  }

  // eslint-disable-next-line no-console
  console.error('\n[docker-asset-parity] FAIL: Dockerfile.api and Dockerfile.worker disagree on runtime asset COPYs.\n');
  if (onlyInA.length) {
    // eslint-disable-next-line no-console
    console.error('  In Dockerfile.api but missing from Dockerfile.worker:');
    for (const t of onlyInA) {
      // eslint-disable-next-line no-console
      console.error(`    - ${t}`);
    }
  }
  if (onlyInB.length) {
    // eslint-disable-next-line no-console
    console.error('  In Dockerfile.worker but missing from Dockerfile.api:');
    for (const t of onlyInB) {
      // eslint-disable-next-line no-console
      console.error(`    - ${t}`);
    }
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix: add the missing `COPY --from=backend-builder ...` line(s) and matching `RUN test -f ...` presence checks to both Dockerfiles.\n' +
      'Why this matters (ADR-0017): the worker pod is what actually renders policy documents. If the worker image lacks an asset the API image has, every relevant issuance fails silently inside BullMQ.\n',
  );
  process.exit(1);
}

main();
