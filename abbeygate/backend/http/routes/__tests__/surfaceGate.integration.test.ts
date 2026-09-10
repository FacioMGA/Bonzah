import express from 'express';
import { afterAll, describe, expect, it } from 'vitest';

import { requireSurfaceAccess } from '../../middleware/surfaceGate.js';

async function withServer(
  app: express.Express,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to resolve server address');
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

describe('surfaceGate integration', () => {
  afterAll(() => {
    // no-op, explicit for parity with other integration suites
  });

  it('rejects public-surface access to bo-only route with 403', async () => {
    const app = express();
    app.get('/bo-only', requireSurfaceAccess(['bo']), (_req, res) => res.json({ ok: true }));

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/bo-only`, {
        headers: { 'x-facio-surface': 'public' },
      });
      expect(res.status).toBe(403);
      const json = (await res.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe('FORBIDDEN');
    });
  });

  it('allows bo-surface access to bo-only route', async () => {
    const app = express();
    app.get('/bo-only', requireSurfaceAccess(['bo']), (_req, res) => res.json({ ok: true }));

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/bo-only`, {
        headers: { 'x-facio-surface': 'bo' },
      });
      expect(res.status).toBe(200);
    });
  });

  it('infers bo surface from authenticated bo role', async () => {
    const app = express();
    app.use((_req, _res, next) => {
      (_req as express.Request & { user?: { role: string } }).user = { role: 'Program Administrator' };
      next();
    });
    app.get('/bo-only', requireSurfaceAccess(['bo']), (_req, res) => res.json({ ok: true }));

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/bo-only`);
      expect(res.status).toBe(200);
    });
  });

  it('enforces client-only surface route contract', async () => {
    const app = express();
    app.get('/client-only', requireSurfaceAccess(['client']), (_req, res) => res.json({ ok: true }));

    await withServer(app, async (baseUrl) => {
      const publicRes = await fetch(`${baseUrl}/client-only`, {
        headers: { 'x-facio-surface': 'public' },
      });
      expect(publicRes.status).toBe(403);

      const boRes = await fetch(`${baseUrl}/client-only`, {
        headers: { 'x-facio-surface': 'bo' },
      });
      expect(boRes.status).toBe(403);

      const clientRes = await fetch(`${baseUrl}/client-only`, {
        headers: { 'x-facio-surface': 'client' },
      });
      expect(clientRes.status).toBe(200);
    });
  });

  it('allows shared route for public, client, and bo surfaces', async () => {
    const app = express();
    app.get('/shared', requireSurfaceAccess(['public', 'client', 'bo']), (_req, res) => res.json({ ok: true }));

    await withServer(app, async (baseUrl) => {
      const surfaces = ['public', 'client', 'bo'] as const;
      for (const surface of surfaces) {
        const res = await fetch(`${baseUrl}/shared`, {
          headers: { 'x-facio-surface': surface },
        });
        expect(res.status).toBe(200);
      }
    });
  });
});
