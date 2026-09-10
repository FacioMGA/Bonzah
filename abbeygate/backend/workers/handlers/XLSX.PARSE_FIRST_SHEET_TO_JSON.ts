import { Job } from 'bullmq';
import { z } from 'zod';
import { storageService } from '../../platform/storage/service.js';
import { registerHandler, JobHandler } from '../index.js';
import { assertSafeXlsxBuffer } from '../../platform/security/xlsxSafety.js';
import { readFirstSheetRowsFromBuffer } from '../../modules/reporting/infra/xlsx/readWorkbookRows.js';

const PayloadSchema = z.object({
    sourceFilename: z.string().min(1, 'XLSX.PARSE_FIRST_SHEET_TO_JSON missing sourceFilename'),
});

export const handleParseFirstSheetToJson: JobHandler = async (job: Job) => {
    const { sourceFilename } = PayloadSchema.parse(job.data);

    const stream = await storageService.getFileStream(sourceFilename);
    if (!stream) throw new Error(`Source XLSX not found in storage: ${sourceFilename}`);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
        stream.on('data', (c: Buffer | Uint8Array | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        stream.on('end', () => resolve());
        stream.on('error', reject);
    });
    const fileBuf = Buffer.concat(chunks);
    assertSafeXlsxBuffer(fileBuf, sourceFilename);

    const rows = await readFirstSheetRowsFromBuffer(fileBuf, sourceFilename);
    if (rows.length === 0) {
        const up = await storageService.uploadFile(Buffer.from('[]'), `${sourceFilename}.rows.json`, 'application/json');
        return { filename: up.filename, url: up.url, rowCount: 0 };
    }

    const up = await storageService.uploadFile(Buffer.from(JSON.stringify(rows)), `${sourceFilename}.rows.json`, 'application/json');
    return { filename: up.filename, url: up.url, rowCount: rows.length };
};

registerHandler('XLSX.PARSE_FIRST_SHEET_TO_JSON', handleParseFirstSheetToJson);
