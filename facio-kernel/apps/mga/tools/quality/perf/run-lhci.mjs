import { spawnSync } from 'node:child_process';
import path from 'node:path';

// LHCI can fail on Apple Silicon when running under Rosetta (x64 Node),
// producing meaningless performance scores and a hard failure.
//
// We still want LHCI runnable in CI (Linux) and on a native arm64 Node on macOS.
if (process.platform === 'darwin' && process.arch === 'x64' && !process.env.PERF_LHCI_FORCE) {
  console.warn(
    [
      '[lhci] Skipping Lighthouse CI on macOS because this Node process is x64 (likely Rosetta).',
      '[lhci] To run locally, install and use an arm64 Node build, then rerun `npm run perf:lighthouse`.',
      '[lhci] (Set PERF_LHCI_FORCE=1 to force an attempt anyway.)',
    ].join('\n'),
  );
  process.exit(0);
}

const bin = path.resolve(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'lhci.cmd' : 'lhci');
const res = spawnSync(bin, ['autorun'], { stdio: 'inherit', env: process.env });
process.exit(res.status ?? 1);

