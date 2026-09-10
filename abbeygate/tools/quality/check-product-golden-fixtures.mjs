#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

const contract = read('backend/modules/policy/domain/productContracts.ts');
if (!contract.includes('ProductGoldenFixtures')) {
  failures.push('productContracts.ts must declare ProductGoldenFixtures');
}
if (!contract.includes('getGoldenFixtures(): ProductGoldenFixtures')) {
  failures.push('IProductAdapter must expose getGoldenFixtures(): ProductGoldenFixtures');
}

for (const relPath of [
  'backend/products/motor/runtime.ts',
  'backend/products/home/runtime.ts',
  'backend/products/travel/runtime.ts',
]) {
  if (!read(relPath).includes('goldenFixtures:')) {
    failures.push(`${relPath}: runtime must expose goldenFixtures`);
  }
}

for (const relPath of [
  'backend/products/motor/goldenFixtures.ts',
  'backend/products/home/goldenFixtures.ts',
  'backend/products/travel/goldenFixtures.ts',
]) {
  const text = read(relPath);
  if (!text.includes('minimumValid')) {
    failures.push(`${relPath}: fixture file must expose minimumValid`);
  }
}

if (failures.length > 0) {
  console.error('Product golden fixture guard failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Product golden fixture guard passed.');
