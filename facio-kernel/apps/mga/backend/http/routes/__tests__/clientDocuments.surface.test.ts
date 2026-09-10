import express from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../documents.js', () => ({
  default: (_req: express.Request, res: express.Response) => res.status(200).json({ route: 'client-documents' }),
}));

async function withServer(app: express.Express, run: (baseUrl: string) => Promise<void>) {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address unavailable');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe('client document surface route', () => {
  it('exposes only GET document binaries to the client surface and leaves BO routing untouched', async () => {
    const { createClientApiRouter } = await import('../client.js');
    const app = express();
    app.use(createClientApiRouter());
    app.use('/documents', (_req, res) => res.status(201).json({ route: 'bo-documents' }));

    await withServer(app, async (baseUrl) => {
      const clientGet = await fetch(`${baseUrl}/documents/schedule.pdf`, {
        headers: { 'x-facio-surface': 'client' },
      });
      expect(clientGet.status).toBe(200);
      await expect(clientGet.json()).resolves.toEqual({ route: 'client-documents' });

      const clientPost = await fetch(`${baseUrl}/documents/upload`, {
        method: 'POST',
        headers: { 'x-facio-surface': 'client' },
      });
      expect(clientPost.status).toBe(403);

      const boGet = await fetch(`${baseUrl}/documents/schedule.pdf`, {
        headers: { 'x-facio-surface': 'bo' },
      });
      expect(boGet.status).toBe(201);
      await expect(boGet.json()).resolves.toEqual({ route: 'bo-documents' });
    });
  });
});
