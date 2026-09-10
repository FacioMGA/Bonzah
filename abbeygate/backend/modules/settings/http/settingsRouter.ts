
import { Router, Request, Response } from 'express';
import { prisma } from '../../../platform/db/connection.js';
import { Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { storageService } from '../../../platform/storage/service.js';
import { resolveUploadsDir } from '../../../platform/runtime/runtimePaths.js';
import { isStorageTemplatePath, readTemplateUploadMode } from '../../../platform/config/templateUploadMode.js';
import { createRestrictedMemoryUpload } from '../../../platform/security/uploadPolicy.js';

import { logger } from '../../../platform/utils/logger.js';
const router = Router();
const TemplateTypeSchema = z.enum(['quote', 'certificate', 'invoice', 'bordereaux']);
const GlobalCommissionsBodySchema = z.object({
    rate: z.union([z.number(), z.string()]),
    splits: z.record(z.string(), z.number()).optional().default({ retailBroker: 10, broker: 10, mga: 80 }),
});
const TemplateSettingsBodySchema = z.object({
    localQuoteTemplatePath: z.string().nullish(),
    localCertificateTemplatePath: z.string().nullish(),
    localInvoiceTemplatePath: z.string().nullish(),
    bordereauxTemplatePath: z.string().nullish(),
});
const EmailTemplateSettingsBodySchema = z.object({
    sendgridAutoQuoteInitialTemplateId: z.string().nullish(),
    sendgridAutoQuoteResendTemplateId: z.string().nullish(),
});

function normalizeFilename(filename: string): string {
    const clean = String(filename || '').trim().replace(/[^\w.\-]+/g, '_');
    return clean || `template-${Date.now()}.docx`;
}

// GET /api/settings/global
// We treat "global" as a singleton Settings record (single row).
router.get('/global_commissions', async (_req: Request, res: Response) => {
    try {
        // Find global settings (first row)
        let setting = await prisma.settings.findFirst({
            orderBy: { updatedAt: 'desc' },
        });

        if (!setting) {
            // Default fallback if no DB record exists
            return res.json({
                success: true,
                data: {
                    rate: 0.23,
                    splits: {
                        retailBroker: 10,
                        broker: 10,
                        mga: 80
                    }
                }
            });
        }

        // Parse the stored JSON string for commissions
        let parsedSplits = { retailBroker: 10, broker: 10, mga: 80 };
        try {
            parsedSplits = JSON.parse(setting.commissions);
        } catch (e) {
            logger.warn({ data: e }, 'Failed to parse commissions JSON');
        }

        return res.json({
            success: true,
            data: {
                rate: Number(setting.defaultRate),
                splits: parsedSplits
            }
        });

    } catch (error) {
        logger.error({ err: error }, 'Error fetching global settings:');
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/settings/global_commissions
router.post('/global_commissions', async (req: Request, res: Response) => {
    try {
        const parsed = GlobalCommissionsBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: 'Invalid global commissions payload',
                details: parsed.error.flatten(),
            });
        }
        const { rate, splits } = parsed.data;

        // Upsert logic: find the first global record, or create a new one
        const existing = await prisma.settings.findFirst({
            orderBy: { updatedAt: 'desc' },
        });

        let setting;
        if (existing) {
            setting = await prisma.settings.update({
                where: { id: existing.id },
                data: {
                    defaultRate: new Prisma.Decimal(rate),
                    commissions: JSON.stringify(splits)
                }
            });
        } else {
            setting = await prisma.settings.create({
                data: {
                    defaultRate: new Prisma.Decimal(rate),
                    commissions: JSON.stringify(splits)
                }
            });
        }

        return res.json({
            success: true,
            data: {
                rate: Number(setting.defaultRate),
                splits: JSON.parse(setting.commissions)
            }
        });

    } catch (error) {
        logger.error({ err: error }, 'Error updating global settings:');
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/settings/templates
router.get('/templates', async (_req: Request, res: Response) => {
    try {
        const templateUploadMode = readTemplateUploadMode();
        const setting = await prisma.settings.findFirst({
            orderBy: { updatedAt: 'desc' },
        });

        if (!setting) {
            return res.json({
                success: true,
                data: {
                    localQuoteTemplatePath: process.env.DOCGEN_QUOTE_TEMPLATE_PATH || null,
                    localCertificateTemplatePath: process.env.DOCGEN_CERTIFICATE_TEMPLATE_PATH || null,
                    localInvoiceTemplatePath: process.env.DOCGEN_INVOICE_TEMPLATE_PATH || null,
                    bordereauxTemplatePath: null,
                    templateUploadMode
                }
            });
        }

        return res.json({
            success: true,
            data: {
                localQuoteTemplatePath: setting.localQuoteTemplatePath || process.env.DOCGEN_QUOTE_TEMPLATE_PATH || null,
                localCertificateTemplatePath: setting.localCertificateTemplatePath || process.env.DOCGEN_CERTIFICATE_TEMPLATE_PATH || null,
                localInvoiceTemplatePath: setting.localInvoiceTemplatePath || process.env.DOCGEN_INVOICE_TEMPLATE_PATH || null,
                bordereauxTemplatePath: setting.bordereauxTemplatePath,
                templateUploadMode
            }
        });

    } catch (error) {
        logger.error({ err: error }, 'Error fetching template settings:');
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/settings/templates
router.post('/templates', async (req: Request, res: Response) => {
    try {
        const parsed = TemplateSettingsBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: 'Invalid template settings payload',
                details: parsed.error.flatten(),
            });
        }
        const {
            localQuoteTemplatePath,
            localCertificateTemplatePath,
            localInvoiceTemplatePath,
            bordereauxTemplatePath
        } = parsed.data;
        const mode = readTemplateUploadMode();
        const rawPaths = [
            localQuoteTemplatePath,
            localCertificateTemplatePath,
            localInvoiceTemplatePath,
            bordereauxTemplatePath,
        ].filter((value) => String(value || '').trim().length > 0);
        if (mode === 'storage' && rawPaths.some((value) => !isStorageTemplatePath(value))) {
            return res.status(400).json({ success: false, error: 'Storage mode only accepts storage URIs. Re-upload template(s).' });
        }
        if (mode === 'disk' && rawPaths.some((value) => isStorageTemplatePath(value))) {
            return res.status(400).json({ success: false, error: 'Disk mode only accepts disk template paths.' });
        }

        const existing = await prisma.settings.findFirst({ orderBy: { updatedAt: 'desc' } });

        let setting;
        if (existing) {
            setting = await prisma.settings.update({
                where: { id: existing.id },
                data: {
                    localQuoteTemplatePath,
                    localCertificateTemplatePath,
                    localInvoiceTemplatePath,
                    bordereauxTemplatePath
                }
            });
        } else {
            // Should probably not happen if global settings are initialized, but safe to handle
            setting = await prisma.settings.create({
                data: {
                    defaultRate: new Prisma.Decimal(0.23), // Defaults
                    commissions: JSON.stringify({ retailBroker: 10, broker: 10, mga: 80 }), // Defaults
                    localQuoteTemplatePath,
                    localCertificateTemplatePath,
                    localInvoiceTemplatePath,
                    bordereauxTemplatePath
                }
            });
        }

        return res.json({
            success: true,
            data: setting
        });

    } catch (error) {
        logger.error({ err: error }, 'Error updating template settings:');
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/settings/email_templates
router.get('/email_templates', async (_req: Request, res: Response) => {
    try {
        const setting = await prisma.settings.findFirst({
            orderBy: { updatedAt: 'desc' },
        });

        return res.json({
            success: true,
            data: {
                sendgridAutoQuoteInitialTemplateId: setting?.sendgridAutoQuoteInitialTemplateId || '',
                sendgridAutoQuoteResendTemplateId: setting?.sendgridAutoQuoteResendTemplateId || '',
            }
        });
    } catch (error) {
        logger.error({ err: error }, 'Error fetching email template settings:');
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/settings/email_templates
router.post('/email_templates', async (req: Request, res: Response) => {
    try {
        const parsed = EmailTemplateSettingsBodySchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email template settings payload',
                details: parsed.error.flatten(),
            });
        }
        const {
            sendgridAutoQuoteInitialTemplateId,
            sendgridAutoQuoteResendTemplateId,
        } = parsed.data;

        const existing = await prisma.settings.findFirst({ orderBy: { updatedAt: 'desc' } });

        let setting;
        if (existing) {
            setting = await prisma.settings.update({
                where: { id: existing.id },
                data: {
                    sendgridAutoQuoteInitialTemplateId,
                    sendgridAutoQuoteResendTemplateId,
                }
            });
        } else {
            setting = await prisma.settings.create({
                data: {
                    defaultRate: new Prisma.Decimal(0.23),
                    commissions: JSON.stringify({ retailBroker: 10, broker: 10, mga: 80 }),
                    sendgridAutoQuoteInitialTemplateId,
                    sendgridAutoQuoteResendTemplateId,
                }
            });
        }

        return res.json({ success: true, data: setting });
    } catch (error) {
        logger.error({ err: error }, 'Error updating email template settings:');
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Configure Multer for file uploads
const upload = createRestrictedMemoryUpload({
    maxFileSizeBytes: 15 * 1024 * 1024,
    allowedMimeTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
    ],
    allowedExtensions: ['.pdf', '.doc', '.docx', '.xlsx', '.xls'],
});

// POST /api/settings/templates/upload
router.post('/templates/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const type = TemplateTypeSchema.parse(req.body.type);
        const mode = readTemplateUploadMode();
        const safeName = normalizeFilename(req.file.originalname);
        let persistedPath = '';
        if (mode === 'disk') {
            const uploadDir = path.join(resolveUploadsDir(), 'templates', `${type}s`);
            await fs.promises.mkdir(uploadDir, { recursive: true });
            await fs.promises.writeFile(path.join(uploadDir, safeName), req.file.buffer);
            persistedPath = `templates/${type}s/${safeName}`;
        } else {
            const uploaded = await storageService.uploadFile(
                req.file.buffer,
                `${type}-template-${safeName}`,
                req.file.mimetype || 'application/octet-stream'
            );
            persistedPath = uploaded.url;
        }

        // Update database with the new path
        const existing = await prisma.settings.findFirst({ orderBy: { updatedAt: 'desc' } });

        if (existing) {
            const updateData: {
                localQuoteTemplatePath?: string;
                localCertificateTemplatePath?: string;
                localInvoiceTemplatePath?: string;
                bordereauxTemplatePath?: string;
            } = {};
            if (type === 'quote') updateData.localQuoteTemplatePath = persistedPath;
            else if (type === 'certificate') updateData.localCertificateTemplatePath = persistedPath;
            else if (type === 'invoice') updateData.localInvoiceTemplatePath = persistedPath;
            else if (type === 'bordereaux') updateData.bordereauxTemplatePath = persistedPath;

            await prisma.settings.update({
                where: { id: existing.id },
                data: updateData
            });
        } else {
            const createData: {
                defaultRate: Prisma.Decimal;
                commissions: string;
                localQuoteTemplatePath?: string;
                localCertificateTemplatePath?: string;
                localInvoiceTemplatePath?: string;
                bordereauxTemplatePath?: string;
            } = {
                defaultRate: new Prisma.Decimal(0.23),
                commissions: JSON.stringify({ retailBroker: 10, broker: 10, mga: 80 }),
            };
            if (type === 'quote') createData.localQuoteTemplatePath = persistedPath;
            else if (type === 'certificate') createData.localCertificateTemplatePath = persistedPath;
            else if (type === 'invoice') createData.localInvoiceTemplatePath = persistedPath;
            else if (type === 'bordereaux') createData.bordereauxTemplatePath = persistedPath;
            await prisma.settings.create({ data: createData });
        }

        return res.json({
            success: true,
            data: {
                path: persistedPath,
                filename: safeName
            }
        });

    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, error: error.issues[0]?.message || 'Invalid template type' });
        }
        logger.error({ err: error }, 'Error uploading template:');
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

export default router;
