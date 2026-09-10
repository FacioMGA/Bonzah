#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

function git(args) {
  return execFileSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function trackedAndUntrackedFiles() {
  const raw = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const files = raw.split('\u0000').filter(Boolean);
  return [...new Set(files)].sort();
}

function fingerprintFiles(files) {
  const digest = crypto.createHash('sha256');
  for (const relativePath of files) {
    const absolutePath = path.join(rootDir, relativePath);
    let stat;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const content = fs.readFileSync(absolutePath);
    const fileHash = crypto.createHash('sha256').update(content).digest('hex');
    digest.update(`${relativePath}\0${fileHash}\0`);
  }
  return digest.digest('hex');
}

const files = trackedAndUntrackedFiles();
const fingerprint = fingerprintFiles(files);
process.stdout.write(`${fingerprint}\n`);
