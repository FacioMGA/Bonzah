import type { RequestHandler } from 'express';
import { Router } from 'express';
import { tenantScopedPrisma, storageService, logger } from '../app/publicDocumentDeps.js';
import { createRestrictedMemoryUpload } from '../../../platform/security/uploadPolicy.js';
import { isClientPublicDocument } from '../app/publicDocumentVisibility.js';
const upload = createRestrictedMemoryUpload({
  maxFileSizeBytes: 10 * 1024 * 1024,
  allowedMimeTypes: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.docx'],
});

function extractLocalStorageFilename(storageUri: string): string | null {
  const m = String(storageUri || '').match(/^\/api\/documents\/([^/?#]+)$/);
  return m?.[1] || null;
}

type PublicDocumentsRouterDeps = {
  auditLog: RequestHandler;
  authenticate: RequestHandler;
};

export function createPublicDocumentsRouter({ auditLog, authenticate }: PublicDocumentsRouterDeps) {
  const router = Router();

  router.post('/upload', authenticate, auditLog, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_FILE', message: 'File is required' } });
    }
    const uploadedFile = await storageService.uploadFile(file.buffer, file.originalname, file.mimetype);
    return res.json({ success: true, data: uploadedFile });
  } catch (e) {
    logger.error({ err: e }, 'Public document upload error:');
    return res.status(500).json({ success: false, error: { code: 'UPLOAD_ERROR', message: (e as Error).message || 'Upload failed' } });
  }
  });

  router.get('/:documentId', auditLog, async (req, res) => {
  try {
    const { documentId } = req.params;
    const quoteTtlMinutes = Number(process.env.PUBLIC_QUOTE_DOC_TTL_MINUTES || 30);
    const policyTtlMinutes = Number(process.env.PUBLIC_POLICY_DOC_TTL_MINUTES || 60);

    const doc = await tenantScopedPrisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        policyId: true,
        docPack: true,
        type: true,
        source: true,
        generatedAt: true,
        storageUri: true,
        filename: true,
      },
    });

    if (!doc) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    const isPublicQuote = String(doc.docPack || '').toUpperCase() === 'QUOTE_PACK';
    if (!isClientPublicDocument(doc)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Document is not publicly accessible' } });
    }

    const ttlMinutes = isPublicQuote ? quoteTtlMinutes : policyTtlMinutes;
    const generatedAt = doc.generatedAt ? new Date(doc.generatedAt) : null;
    const expiresAt = generatedAt ? new Date(generatedAt.getTime() + ttlMinutes * 60_000) : null;
    if (!generatedAt || !expiresAt || Date.now() > expiresAt.getTime()) {
      return res.status(410).json({
        success: false,
        error: {
          code: 'EXPIRED',
          message: isPublicQuote
            ? 'This download link has expired. Please regenerate the quote PDF.'
            : 'This download link has expired. Please download your documents again from your dashboard.',
        },
      });
    }

    const storageUri = String(doc.storageUri || '');
    if (/^https?:\/\//i.test(storageUri)) {
      return res.redirect(storageUri);
    }

    const localFilename = extractLocalStorageFilename(storageUri);
    if (!localFilename) {
      return res.status(500).json({ success: false, error: { code: 'BAD_STORAGE_URI', message: 'Unsupported storage URI' } });
    }

    const stream = await storageService.getFileStream(localFilename);
    if (!stream) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'File not found' } });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${String(doc.filename || 'Quote.pdf').replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    stream.pipe(res);
  } catch (e) {
    logger.error({ err: e }, 'Public document download error:');
    res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: (e as Error).message } });
  }
  });

  return router;
}
