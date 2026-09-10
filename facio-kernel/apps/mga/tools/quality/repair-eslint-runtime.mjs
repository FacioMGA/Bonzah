import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const semverRoot = path.join(root, 'node_modules', 'semver');
const semverParseFile = path.join(semverRoot, 'functions', 'parse.js');
const eslintRoot = path.join(root, 'node_modules', 'eslint');
const eslintSourceCodeDir = path.join(root, 'node_modules', 'eslint', 'lib', 'languages', 'js', 'source-code');
const eslintSourceCodeIndex = path.join(eslintSourceCodeDir, 'index.js');
const eslintTokenStoreCursors = path.join(eslintSourceCodeDir, 'token-store', 'cursors.js');

async function semverHealthy() {
  try {
    const content = await readFile(semverParseFile, 'utf8');
    return content.includes('module.exports');
  } catch {
    return false;
  }
}

async function eslintHealthy() {
  try {
    const [indexContent, cursorsContent] = await Promise.all([
      readFile(eslintSourceCodeIndex, 'utf8'),
      readFile(eslintTokenStoreCursors, 'utf8'),
    ]);
    return indexContent.includes('SourceCode') && indexContent.includes("require('./source-code.js')") && cursorsContent.length > 0;
  } catch {
    return false;
  }
}

function packAndReplacePackage(args) {
  const tempDir = args.tempDir;
  const pack = spawnSync('npm', ['pack', `${args.packageName}@${args.version}`], {
    cwd: tempDir,
    encoding: 'utf8',
  });
  if (pack.status !== 0) {
    process.stderr.write(pack.stderr || `[fix:eslint-runtime] npm pack failed for ${args.packageName}\n`);
    process.exit(pack.status ?? 1);
  }

  const tarballName = (pack.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  if (!tarballName) {
    console.error(`[fix:eslint-runtime] could not resolve tarball name for ${args.packageName}`);
    process.exit(1);
  }

  const tarballPath = path.join(tempDir, tarballName);
  const extract = spawnSync('tar', ['-xzf', tarballPath], {
    cwd: tempDir,
    encoding: 'utf8',
  });
  if (extract.status !== 0) {
    process.stderr.write(extract.stderr || `[fix:eslint-runtime] tar extraction failed for ${args.packageName}\n`);
    process.exit(extract.status ?? 1);
  }

  return rm(args.targetDir, { recursive: true, force: true })
    .then(() => {
      const move = spawnSync('mv', [path.join(tempDir, 'package'), args.targetDir], {
        cwd: root,
        encoding: 'utf8',
      });
      if (move.status !== 0) {
        process.stderr.write(move.stderr || `[fix:eslint-runtime] failed to replace ${args.packageName} package\n`);
        process.exit(move.status ?? 1);
      }
    });
}

const semverOk = await semverHealthy();
const eslintOk = await eslintHealthy();
if (semverOk && eslintOk) {
  console.log('[fix:eslint-runtime] semver package is healthy');
  console.log('[fix:eslint-runtime] eslint source-code shim is healthy');
  process.exit(0);
}

if (!semverOk) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'semver-repair-'));
  await packAndReplacePackage({
    tempDir,
    packageName: 'semver',
    version: '7.7.3',
    targetDir: semverRoot,
  });
  console.log('[fix:eslint-runtime] semver package repaired from npm tarball');
}

if (!eslintOk) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'eslint-repair-'));
  await packAndReplacePackage({
    tempDir,
    packageName: 'eslint',
    version: '9.39.2',
    targetDir: eslintRoot,
  });
  await mkdir(eslintSourceCodeDir, { recursive: true });
  await writeFile(
    eslintSourceCodeIndex,
    "'use strict';\n\nconst SourceCode = require('./source-code.js');\n\nmodule.exports = { SourceCode };\n",
    'utf8',
  );
  console.log('[fix:eslint-runtime] eslint package repaired from npm tarball');
}
