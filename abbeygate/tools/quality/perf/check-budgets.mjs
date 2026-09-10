import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIST_DIR = path.resolve(process.cwd(), 'dist');
const ASSETS_DIR = path.join(DIST_DIR, 'assets');

const BUDGETS = {
  // Keep these conservative initially; tighten after a baseline measurement.
  // Baseline (2026-02): ~2.22MB total JS, ~477kb largest chunk.
  maxTotalJsBytes: 2_400_000,
  maxLargestJsChunkBytes: 520_000,
  maxTotalCssBytes: 180_000,
};

function fmt(bytes) {
  const kb = bytes / 1024;
  return `${kb.toFixed(1)}kb`;
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.isFile()) out.push(path.join(dir, e.name));
  }
  return out;
}

function assertBudget(ok, message) {
  if (!ok) {
    const err = new Error(message);
    err.code = 'BUDGET_EXCEEDED';
    throw err;
  }
}

async function main() {
  try {
    await fs.access(ASSETS_DIR);
  } catch {
    throw new Error(
      `Build output not found. Run \`npm run build:frontend\` first (expected ${ASSETS_DIR}).`,
    );
  }

  const files = await listFiles(ASSETS_DIR);
  const js = files.filter((f) => f.endsWith('.js'));
  const css = files.filter((f) => f.endsWith('.css'));

  const sizes = await Promise.all(
    [...js, ...css].map(async (f) => ({ file: f, bytes: (await fs.stat(f)).size })),
  );

  const jsSizes = sizes.filter((s) => s.file.endsWith('.js'));
  const cssSizes = sizes.filter((s) => s.file.endsWith('.css'));

  const totalJs = jsSizes.reduce((a, b) => a + b.bytes, 0);
  const totalCss = cssSizes.reduce((a, b) => a + b.bytes, 0);
  const largestJs = jsSizes.reduce((m, s) => (s.bytes > m ? s.bytes : m), 0);
  const largestJsFile = jsSizes.sort((a, b) => b.bytes - a.bytes)[0]?.file || '(none)';

  // Report
  console.log(`[budgets] total JS: ${fmt(totalJs)} (budget ${fmt(BUDGETS.maxTotalJsBytes)})`);
  console.log(`[budgets] largest JS: ${fmt(largestJs)} (budget ${fmt(BUDGETS.maxLargestJsChunkBytes)})`);
  console.log(`[budgets] largest JS file: ${path.relative(process.cwd(), largestJsFile)}`);
  console.log(`[budgets] total CSS: ${fmt(totalCss)} (budget ${fmt(BUDGETS.maxTotalCssBytes)})`);

  // Enforce
  assertBudget(totalJs <= BUDGETS.maxTotalJsBytes, `Total JS budget exceeded: ${fmt(totalJs)} > ${fmt(BUDGETS.maxTotalJsBytes)}`);
  assertBudget(largestJs <= BUDGETS.maxLargestJsChunkBytes, `Largest JS chunk budget exceeded: ${fmt(largestJs)} > ${fmt(BUDGETS.maxLargestJsChunkBytes)}`);
  assertBudget(totalCss <= BUDGETS.maxTotalCssBytes, `Total CSS budget exceeded: ${fmt(totalCss)} > ${fmt(BUDGETS.maxTotalCssBytes)}`);
}

main().catch((err) => {
  console.error(`[budgets] FAIL: ${err?.message || err}`);
  process.exit(1);
});

