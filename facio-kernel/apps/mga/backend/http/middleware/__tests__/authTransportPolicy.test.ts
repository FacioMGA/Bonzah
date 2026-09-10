import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock('../../../platform/db/connection.js', () => ({
  prisma: {
    user: {
      findUnique: dbMocks.findUnique,
    },
  },
}));

describe('auth transport policy', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    dbMocks.findUnique.mockResolvedValue({
      id: 'user_1',
      email: 'user@example.com',
      role: 'ADMIN',
      isActive: true,
      tokenVersion: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects query-string token auth attempts', async () => {
    const { authenticate } = await import('../../../platform/http/middleware/auth.js');
    const { logger } = await import('../../../platform/utils/logger.js');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const app = express();
    app.get('/protected', authenticate, (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    try {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('address unavailable');
      const response = await fetch(`http://127.0.0.1:${addr.port}/protected?token=abc123`);
      expect(response.status).toBe(401);
    } finally {
      warnSpy.mockRestore();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('accepts bearer authorization token', async () => {
    const { authenticate } = await import('../../../platform/http/middleware/auth.js');
    const app = express();
    app.get('/protected', authenticate, (_req, res) => res.json({ ok: true }));
    const token = jwt.sign({ id: 'user_1', tokenVersion: 0 }, process.env.JWT_SECRET as string);
    const server = app.listen(0);
    try {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('address unavailable');
      const response = await fetch(`http://127.0.0.1:${addr.port}/protected`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('redacts token-like query params from request logs', async () => {
    const { requestLogger } = await import('../logger.js');
    const { logger } = await import('../../../platform/utils/logger.js');
    const infoSpy = vi.spyOn(logger, 'info');
    const app = express();
    app.use(requestLogger);
    app.get('/healthz', (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    try {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('address unavailable');
      await fetch(`http://127.0.0.1:${addr.port}/healthz?token=abc123&foo=bar`);
      const logCall = infoSpy.mock.calls.find((c) => c[1] === 'http.request');
      expect(logCall).toBeTruthy();
      const meta = (logCall?.[0] || {}) as Record<string, unknown>;
      const url = String(meta.url || '');
      expect(url).toContain('foo=bar');
      expect(url).not.toContain('abc123');
      expect(url).toContain('token=***');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
