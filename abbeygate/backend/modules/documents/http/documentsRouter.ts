// FacioMGA - Generic Document API Routes
// Handles file uploads for claims, policies, etc.

import { Router, type NextFunction, type Request, type Response } from 'express';
import { extname } from 'path';
import { z } from 'zod';
import { storageService } from '../../../platform/storage/service.js';
import { requireDocumentFetchPermission } from '../../accessControl/http/permissionMiddleware.js';

import type { ApiResponse } from '../../../platform/types/index.js';

import { logger } from '../../../platform/utils/logger.js';
import { createRestrictedMemoryUpload } from '../../../platform/security/uploadPolicy.js';
const router = Router();

function documentsAuditLog(req: Request, _res: Response, next: NextFunction): void {
  try {
    const correlationId = (req.headers['x-correlation-id'] as string) || req.correlationId;
    const actionId = req.headers['x-action-id'] as string;
    const tenantId = String(req.headers['x-tenant-id'] || '').trim() || undefined;
    const textUser = req.user;
    const actorId = textUser?.id || 'system';
    const actorType = textUser?.role || 'SYSTEM';
    req.auditContext = { correlationId, actionId, tenantId, actorId, actorType };
    next();
  } catch {
    next();
  }
}
type ErrorBody = ApiResponse<null>;

const UploadContextSchema = z.object({
  policyId: z.string().trim().min(1).optional(),
  contextId: z.string().trim().min(1).optional(),
});

const DownloadParamsSchema = z.object({
  filename: z.string().trim().min(1, 'filename is required'),
});

const DownloadQuerySchema = z.object({
  inline: z.union([z.literal('1'), z.literal('0')]).optional(),
});

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function sendError(res: { status: (code: number) => { json: (payload: ErrorBody) => unknown } }, status: number, code: string, message: string) {
  const payload: ErrorBody = {
    success: false,
    error: { code, message },
  };
  return res.status(status).json(payload);
}

function actorIdFromRequest(req: { user?: Express.UserTokenPayload }): string {
  return req.user && typeof req.user.id === 'string' ? req.user.id : 'system';
}

// Configure multer for file uploads
const upload = createRestrictedMemoryUpload({
    maxFileSizeBytes: 10 * 1024 * 1024,
    allowedMimeTypes: [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/webp',
        'text/plain',
        'text/csv',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.csv', '.docx', '.xlsx'],
});

/**
 * POST /api/documents/upload
 * Generic file upload endpoint
 */
router.post('/upload', documentsAuditLog, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return sendError(res, 400, 'MISSING_FILE', 'File is required');
    }

    const uploadedFile = await storageService.uploadFile(file.buffer, file.originalname, file.mimetype);
    res.json({
      success: true,
      data: uploadedFile,
    });

    const context = UploadContextSchema.safeParse(req.body);
    if (context.success) {
      const policyId = context.data.policyId || context.data.contextId;
      if (policyId) {
        const { AuditLogger } = await import('../../../platform/audit/logger.js');
        await AuditLogger.log(
          policyId,
          'POLICY',
          'DOCUMENT.CREATED',
          actorIdFromRequest(req),
          'USER',
          {
            fileName: file.originalname,
            type: 'Upload',
          }
        );
      }
    }
    return;
  } catch (error) {
    logger.error({ err: error }, 'File upload error:');
    return sendError(res, 500, 'UPLOAD_ERROR', errorMessage(error, 'Upload failed'));
  }
});

/**
 * GET /api/documents/:filename
 * Securely download or view a file
 *
 * Query:
 * - inline=1  -> Content-Disposition: inline (for in-browser viewing)
 */
router.get('/:filename', documentsAuditLog, requireDocumentFetchPermission(), async (req, res) => {
  try {
    const { filename } = DownloadParamsSchema.parse(req.params);
    const query = DownloadQuerySchema.safeParse(req.query);
    const inline = query.success && query.data.inline === '1';

    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ success: false, error: 'Invalid filename' });
    }

    const fileStream = await storageService.getFileStream(filename);
    if (!fileStream) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const ext = extname(filename).toLowerCase();
    const contentType =
      ext === '.pdf' ? 'application/pdf'
        : ext === '.png' ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);
    return fileStream.pipe(res);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid filename' });
    }
    logger.error({ err: error }, 'Download error:');
    return res.status(404).json({ success: false, error: 'File not found or inaccessible' });
  }
});

export default router;
