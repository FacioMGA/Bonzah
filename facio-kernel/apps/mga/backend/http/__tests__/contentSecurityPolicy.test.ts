import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('backend content security policy', () => {
  it('allows frontend Sentry envelope ingestion', () => {
    const indexSource = fs.readFileSync(path.resolve(process.cwd(), 'backend/index.ts'), 'utf8');
    const connectSrcMatch = indexSource.match(/connectSrc:\s*\[(?<entries>[\s\S]*?)\]/);
    const scriptSrcMatch = indexSource.match(/scriptSrc:\s*\[(?<entries>[\s\S]*?)\]/);

    expect(connectSrcMatch?.groups?.entries).toContain('https://*.ingest.us.sentry.io');
    expect(scriptSrcMatch?.groups?.entries).not.toContain('https://*.ingest.us.sentry.io');
  });

  it('allows developer portal CORS requests with API and idempotency headers', () => {
    const indexSource = fs.readFileSync(path.resolve(process.cwd(), 'backend/index.ts'), 'utf8');

    expect(indexSource).toContain('https://developers.facio.io');
    expect(indexSource).toContain('X-API-Key');
    expect(indexSource).toContain('X-Idempotency-Key');
    expect(indexSource).toContain('X-Tenant-Id');
  });

  it('allows dynamic 3DS issuer frames without widening scripts or connects', () => {
    const indexSource = fs.readFileSync(path.resolve(process.cwd(), 'backend/index.ts'), 'utf8');
    const globalFrameSrcMatch = indexSource.match(/frameSrc:\s*\[(?<entries>[\s\S]*?)\]/);
    const formActionMatch = indexSource.match(/formAction:\s*\[(?<entries>[\s\S]*?)\]/);
    const scriptSrcMatch = indexSource.match(/scriptSrc:\s*\[(?<entries>[\s\S]*?)\]/);
    const connectSrcMatch = indexSource.match(/connectSrc:\s*\[(?<entries>[\s\S]*?)\]/);

    expect(globalFrameSrcMatch?.groups?.entries).toContain('https://*.oppwa.com');
    expect(globalFrameSrcMatch?.groups?.entries).toMatch(/['"]https:['"]/);
    expect(formActionMatch?.groups?.entries).toMatch(/['"]https:['"]/);
    expect(scriptSrcMatch?.groups?.entries).not.toMatch(/['"]https:['"]/);
    expect(connectSrcMatch?.groups?.entries).not.toMatch(/['"]https:['"]/);
  });
});
