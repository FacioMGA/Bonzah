import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workspace = resolve(root, 'rust');
const cargo = process.env.CARGO ?? 'cargo';
const rustc = process.env.RUSTC ?? 'rustc';
const compiler = execFileSync(rustc, ['--version'], { encoding: 'utf8' }).trim();
if (!compiler.startsWith('rustc 1.97.1 '))
  throw new Error(
    'Build requires pinned Rust1.97.1 and wasm32-unknown-unknown target; install through rustup before building.',
  );
const inputFiles = [
  'Cargo.toml',
  'Cargo.lock',
  'rust-toolchain.toml',
  '.cargo/config.toml',
  'money/Cargo.toml',
  'money/src/lib.rs',
];
const sourceHash = createHash('sha256');
for (const path of inputFiles)
  sourceHash
    .update(path + '\n')
    .update(readFileSync(resolve(workspace, path)))
    .update('\n');
execFileSync(
  cargo,
  [
    'build',
    '--manifest-path',
    'money/Cargo.toml',
    '--locked',
    '--offline',
    '--release',
    '--target-dir',
    resolve(workspace, 'target'),
    '--target',
    'wasm32-unknown-unknown',
  ],
  {
    cwd: workspace,
    stdio: 'inherit',
    env: { ...process.env, RUSTUP_TOOLCHAIN: '1.97.1' },
  },
);
const wasm = readFileSync(
  resolve(workspace, 'target/wasm32-unknown-unknown/release/facio_money.wasm'),
);
const module = new WebAssembly.Module(wasm);
if (WebAssembly.Module.imports(module).length)
  throw new Error('Exact money WASM must not import any host capability');
const manifest = {
  engine: 'rust-wasm',
  engineVersion: '1.0.0',
  abiVersion: 1,
  calculationVersion: 'exact-money-v1',
  compiler,
  target: 'wasm32-unknown-unknown',
  sourceSha256: sourceHash.digest('hex'),
  wasmSha256: createHash('sha256').update(wasm).digest('hex'),
  wasmBytes: wasm.byteLength,
  memoryBytes: 131072,
};
writeFileSync(resolve(workspace, 'money.wasm'), wasm);
writeFileSync(resolve(workspace, 'money.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
