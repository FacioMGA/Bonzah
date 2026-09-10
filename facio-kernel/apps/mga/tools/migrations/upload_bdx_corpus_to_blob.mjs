#!/usr/bin/env node
import { BlobServiceClient } from '@azure/storage-blob';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const corpusDir = path.resolve(process.env.BDX_CORPUS_DIR || 'artifacts/BDX-import-april-26');
const containerName = String(process.env.BDX_BLOB_CONTAINER || process.env.STORAGE_CONTAINER_NAME || '').trim();
const connectionString = String(process.env.BDX_STORAGE_CONNECTION_STRING || process.env.STORAGE_CONNECTION_STRING || '').trim();
const prefix = String(process.env.BDX_BLOB_PREFIX || `bdx-import-april-26/${new Date().toISOString().replace(/[:.]/g, '-')}`).replace(/^\/+|\/+$/g, '');
const outPath = path.resolve(process.env.BDX_CORPUS_MANIFEST_OUT || `tmp/bdx-corpus-manifest-${Date.now()}.json`);

if (!containerName) throw new Error('Set BDX_BLOB_CONTAINER or STORAGE_CONTAINER_NAME');
if (!connectionString) throw new Error('Set BDX_STORAGE_CONNECTION_STRING or STORAGE_CONNECTION_STRING');

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    if (entry.isFile() && /\.(xlsx|csv)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function productLineFor(relativePath) {
  if (/brit travel/i.test(relativePath)) return 'travel';
  if (/beazley home/i.test(relativePath)) return 'home';
  return 'motor';
}

function tenantEntriesFor(relativePath, blobName, fileType) {
  const productLine = productLineFor(relativePath);
  if (productLine === 'home') {
    return [
      { tenantSlug: 'abbeygate-cy', tenantHost: 'abbeygate-cy.facio.io', sheetName: 'Cyprus' },
      { tenantSlug: 'abbeygate-pt', tenantHost: 'abbeygate-pt.facio.io', sheetName: 'Portugal' },
    ].map((entry) => ({ ...entry, productLine, fileType, blobName, sourceLabel: relativePath }));
  }
  if (productLine === 'travel') {
    return [
      { tenantSlug: 'abbeygate-cy', tenantHost: 'abbeygate-cy.facio.io', sheetName: 'Cyprus' },
      { tenantSlug: 'abbeygate-pt', tenantHost: 'abbeygate-pt.facio.io', sheetName: 'Portugal' },
    ].map((entry) => ({ ...entry, productLine, fileType, blobName, sourceLabel: relativePath }));
  }
  const tenantSlug = /motor-pt|portugal/i.test(relativePath) ? 'abbeygate-pt' : 'abbeygate-cy';
  return [{
    tenantSlug,
    tenantHost: tenantSlug === 'abbeygate-pt' ? 'abbeygate-pt.facio.io' : 'abbeygate-cy.facio.io',
    productLine,
    fileType,
    blobName,
    sourceLabel: relativePath,
  }];
}

async function sha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const service = BlobServiceClient.fromConnectionString(connectionString);
  const container = service.getContainerClient(containerName);
  await container.createIfNotExists();
  const sourceFiles = await walk(corpusDir);
  if (sourceFiles.length === 0) throw new Error(`No BDX files found under ${corpusDir}`);

  const files = [];
  const manifestEntries = [];
  for (const filePath of sourceFiles) {
    const relativePath = path.relative(corpusDir, filePath).split(path.sep).join('/');
    const blobName = `${prefix}/source/${relativePath}`;
    const fileType = filePath.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
    const blockBlob = container.getBlockBlobClient(blobName);
    await blockBlob.uploadFile(filePath, {
      blobHTTPHeaders: {
        blobContentType: fileType === 'csv'
          ? 'text/csv'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
    const stat = await fs.stat(filePath);
    const hash = await sha256(filePath);
    files.push({ relativePath, blobName, bytes: stat.size, sha256: hash });
    manifestEntries.push(...tenantEntriesFor(relativePath, blobName, fileType));
    console.log(`[bdx-corpus-upload] uploaded ${relativePath} -> ${blobName}`);
  }

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    corpusDir,
    containerName,
    prefix,
    files,
    entries: manifestEntries,
  };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const manifestBlobName = `${prefix}/manifest.json`;
  await container.getBlockBlobClient(manifestBlobName).uploadFile(outPath, {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
  console.log(`[bdx-corpus-upload] manifest=${outPath}`);
  console.log(`[bdx-corpus-upload] manifestBlob=${manifestBlobName}`);
  console.log(JSON.stringify({ containerName, manifestBlobName, entries: manifestEntries.length, files: files.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
