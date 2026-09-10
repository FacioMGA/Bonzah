import type { Prisma } from '@prisma/client';
import { Job } from 'bullmq';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tenantScopedPrisma } from '../../platform/db/connection.js';
import { storageService } from '../../platform/storage/service.js';
import { ensureUploadsDirReady } from '../../platform/runtime/runtimePaths.js';
import { runWithPolicyOperatingTenant } from '../../platform/tenant/tenantJobContext.js';
import { logger } from '../../platform/utils/logger.js';
import { registerHandler, JobHandler } from '../index.js';

const execFileAsync = promisify(execFile);
type DocumentCreateData = Omit<Prisma.DocumentUncheckedCreateInput, 'operatingTenantId'>;

// Schema for DOC.DOCX_TO_PDF.
// Producer (canonical): backend/modules/documents/domain/adapters/DocxAdapter.ts
//
// `targetType` is REQUIRED. It used to default silently to
// `'DOCX_CONVERTED_PDF'`, which mis-classified Document rows whenever a
// producer forgot to pass it (downstream BDX / doc-pack / policy-list
// queries filter by `Document.type`).
const PayloadSchema = z.object({
    sourceFilename: z.string()
        .min(1, 'DOC.DOCX_TO_PDF missing sourceFilename')
        .refine((v) => v.toLowerCase().endsWith('.docx'), {
            message: "DOC.DOCX_TO_PDF sourceFilename must end with .docx",
        }),
    targetType: z.string().min(1, 'DOC.DOCX_TO_PDF missing targetType'),
    policyId: z.string().nullish(),
    riskTransactionId: z.string().nullish(),
    docPack: z.string().nullish(),
    templateVersion: z.string().nullish(),
    generatedByUserId: z.string().nullish(),
    source: z.string().optional().default('SYSTEM'),
    // Producer-side metadata, kept for observability but unused by the converter.
    sourceDocumentId: z.string().optional(),
    sourceStorageUri: z.string().optional(),
});

type DocxToPdfPayload = z.infer<typeof PayloadSchema>;

export const handleDocxToPdf: JobHandler = async (job: Job) => {
    const data = PayloadSchema.parse(job.data);
    if (data.policyId) {
        return runWithPolicyOperatingTenant(data.policyId, () => convertDocxToPdf(data));
    }
    return convertDocxToPdf(data);
};

async function convertDocxToPdf(data: DocxToPdfPayload): Promise<void> {
    const image = String(process.env.DOCX_PDF_CONVERTER_IMAGE || 'domnulnopcea/libreoffice-headless:latest');
    const mode = String(process.env.DOCX_PDF_CONVERTER_MODE || 'docker').toLowerCase();

    if (mode !== 'docker') {
        throw new Error(`DOCX_PDF_CONVERTER_MODE must be 'docker' to convert (got '${mode}')`);
    }

    const uploadsDir = ensureUploadsDirReady();
    const inputPath = path.join(uploadsDir, data.sourceFilename);
    if (!fs.existsSync(inputPath)) {
        throw new Error(`DOCX_TO_PDF source file not found on disk: ${inputPath}`);
    }

    const pdfFilename = data.sourceFilename.replace(/\.docx$/i, '.pdf');
    const outputPath = path.join(uploadsDir, pdfFilename);

    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* ignore */ }

    await execFileAsync('docker', [
        'run',
        '--rm',
        '-v',
        `${uploadsDir}:/data`,
        image,
        'libreoffice',
        '--headless',
        '--nologo',
        '--nolockcheck',
        '--convert-to',
        'pdf',
        `/data/${data.sourceFilename}`,
        '--outdir',
        '/data',
    ]);

    if (!fs.existsSync(outputPath)) {
        // Some images use `soffice` instead of `libreoffice`.
        await execFileAsync('docker', [
            'run',
            '--rm',
            '-v',
            `${uploadsDir}:/data`,
            image,
            'soffice',
            '--headless',
            '--nologo',
            '--nolockcheck',
            '--convert-to',
            'pdf',
            `/data/${data.sourceFilename}`,
            '--outdir',
            '/data',
        ]).catch(() => undefined);
    }

    if (!fs.existsSync(outputPath)) {
        throw new Error(`DOCX_TO_PDF conversion did not produce output: ${outputPath}`);
    }

    const buf = fs.readFileSync(outputPath);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');

    const uploaded = await storageService.uploadFile(buf, pdfFilename, 'application/pdf');

    const documentData: DocumentCreateData = {
        policyId: data.policyId ?? null,
        riskTransactionId: data.riskTransactionId ?? null,
        type: data.targetType,
        docPack: data.docPack ?? null,
        status: 'GENERATED',
        templateVersion: data.templateVersion ?? null,
        generatedByUserId: data.generatedByUserId ?? null,
        source: data.source,
        generatedAt: new Date(),
        storageUri: uploaded.url,
        filename: uploaded.filename,
        fileHash: hash,
    };
    await tenantScopedPrisma.document.create({
        data: documentData as Prisma.DocumentUncheckedCreateInput,
    });

    logger.info({ sourceFilename: data.sourceFilename, pdfFilename, storageUri: uploaded.url }, 'doc.docx_to_pdf.converted');
}

registerHandler('DOC.DOCX_TO_PDF', handleDocxToPdf);
