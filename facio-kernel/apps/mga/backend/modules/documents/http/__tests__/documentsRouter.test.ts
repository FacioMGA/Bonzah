import express from 'express';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getFileStream: vi.fn(),
}));

vi.mock('../../../../platform/storage/service.js', () => ({
  storageService: {
    getFileStream: storageMocks.getFileStream,
    uploadFile: vi.fn(),
  },
}));

vi.mock('../../../accessControl/http/permissionMiddleware.js', () => ({
  requireDocumentFetchPermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

describe('documentsRouter download behavior', () => {
  beforeEach(() => {
    storageMocks.getFileStream.mockResolvedValue(Readable.from(['pdf-content']));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sets inline content disposition when inline=1', async () => {
    const { default: documentsRouter } = await import('../documentsRouter.js');
    const app = express();
    app.use('/documents', documentsRouter);
    const server = app.listen(0);
    try {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('address unavailable');
      const response = await fetch(`http://127.0.0.1:${addr.port}/documents/file-1.pdf?inline=1`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain('inline');
      expect(response.headers.get('content-type')).toContain('application/pdf');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('defaults to attachment disposition without inline query', async () => {
    const { default: documentsRouter } = await import('../documentsRouter.js');
    const app = express();
    app.use('/documents', documentsRouter);
    const server = app.listen(0);
    try {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('address unavailable');
      const response = await fetch(`http://127.0.0.1:${addr.port}/documents/file-2.pdf`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain('attachment');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('rejects path traversal filenames', async () => {
    const { default: documentsRouter } = await import('../documentsRouter.js');
    const app = express();
    app.use('/documents', documentsRouter);
    const server = app.listen(0);
    try {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('address unavailable');
      const response = await fetch(`http://127.0.0.1:${addr.port}/documents/..%2Fsecret.pdf`);
      expect(response.status).toBe(400);
      expect(storageMocks.getFileStream).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

