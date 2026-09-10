import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import { resolveTravelIpid } from '../../../../products/travel/documents/ipid.js';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), stream: vi.fn(), exists: vi.fn() }));
vi.mock('../../app/productRegistryService.js', () => ({ resolveProductIpidAsset: mocks.resolve }));
vi.mock('../../../../platform/tenant/tenantConfig.js', () => ({ getTenantConfig: () => ({ countryCode: 'CY' }) }));
vi.mock('../../../../platform/utils/logger.js', () => ({ logger: { warn: vi.fn() } }));
vi.mock('node:fs', () => ({ existsSync: mocks.exists, createReadStream: mocks.stream }));

const { createPublicIpidRouter } = await import('../publicIpidRouter.js');
let server: Server;
let baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.set('query parser', 'extended');
  app.use('/ipid', createPublicIpidRouter());
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP test server');
  baseUrl = `http://127.0.0.1:${address.port}/ipid/travel`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exists.mockReturnValue(true);
  mocks.stream.mockImplementation(() => Readable.from([Buffer.from('%PDF-selected-ipid')]));
  mocks.resolve.mockImplementation((_product, _country, selection) => {
    const asset = resolveTravelIpid(selection);
    return { absolutePath: asset.staticPdfPath, filename: asset.filename };
  });
});

describe('public IPID variant boundary', () => {
  it.each([
    ['single_trip', 'Travel_Single_Trip_IPID.pdf'],
    ['annual_multi_trip', 'Travel_Annual_Multi_Trip_IPID.pdf'],
  ])('serves the selected %s disclosure', async (variant, filename) => {
    const response = await fetch(`${baseUrl}?variant=${variant}`);
    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith('TRAVEL', 'CY', { variant });
    expect(response.headers.get('Content-Disposition')).toBe(`inline; filename="${filename}"`);
    expect(await response.text()).toBe('%PDF-selected-ipid');
  });

  it.each([undefined, '', 'annual', 'unknown'])('does not substitute an IPID for missing/invalid selection %s', async (variant) => {
    const response = await fetch(baseUrl + (variant === undefined ? '' : `?variant=${variant}`));
    expect(response.status).toBe(404);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it.each(['variant=single_trip&variant=annual_multi_trip', 'variant[planType]=annual_multi_trip'])('rejects a non-scalar selector %s', async (query) => {
    const response = await fetch(`${baseUrl}?${query}`);
    expect(response.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });
});
