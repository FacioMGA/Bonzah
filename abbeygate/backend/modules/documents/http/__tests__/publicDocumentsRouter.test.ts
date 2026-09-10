import express from 'express';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const depsMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getFileStream: vi.fn(),
}));

vi.mock('../../app/publicDocumentDeps.js', () => ({
  tenantScopedPrisma: {
    document: {
      findUnique: depsMocks.findUnique,
    },
  },
  storageService: {
    uploadFile: vi.fn(),
    getFileStream: depsMocks.getFileStream,
  },
  logger: {
    error: vi.fn(),
  },
}));

function noopMiddleware(_req: express.Request, _res: express.Response, next: express.NextFunction) {
  next();
}

describe('publicDocumentsRouter', () => {
  beforeEach(() => {
    depsMocks.findUnique.mockResolvedValue({
      id: 'doc-wording',
      policyId: 'pol-1',
      docPack: 'ISSUED_POLICY_PACK',
      type: 'HOME_POLICY_WORDING_PDF',
      source: 'SYSTEM',
      generatedAt: new Date(),
      storageUri: '/api/documents/home-wording.pdf',
      filename: 'Home_Policy_Wording_Cyprus_Domiciled.pdf',
    });
    depsMocks.getFileStream.mockResolvedValue(Readable.from(['pdf-content']));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('serves home issued-pack static documents using the same visibility rule as the document list', async () => {
    const { createPublicDocumentsRouter } = await import('../publicDocumentsRouter.js');
    const app = express();
    app.use('/public/documents', createPublicDocumentsRouter({ auditLog: noopMiddleware, authenticate: noopMiddleware }));
    const server = app.listen(0);
    try {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('address unavailable');
      const response = await fetch(`http://127.0.0.1:${addr.port}/public/documents/doc-wording`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/pdf');
      expect(response.headers.get('content-disposition')).toContain('Home_Policy_Wording_Cyprus_Domiciled.pdf');
      expect(depsMocks.getFileStream).toHaveBeenCalledWith('home-wording.pdf');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
