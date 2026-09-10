import { Job } from 'bullmq';
import { z } from 'zod';
import { storageService } from '../../platform/storage/service.js';
import { registerHandler, JobHandler } from '../index.js';
import { writeBdxWorkbookBuffer } from '../../modules/reporting/infra/xlsx/writeBdxWorkbook.js';
import { logger } from '../../platform/utils/logger.js';
import { ensureCorrelationId, runWithCorrelationId } from '../../platform/observability/context.js';
import { tenantScopedPrisma } from '../../platform/db/connection.js';
import { runWithBinderOperatingTenant } from '../../platform/tenant/tenantJobContext.js';

/**
 * Worker payload (canonical shape, validated below):
 *   - binderId, year, month, stream                 (required)
 *   - filenameBase                                   (required base name; suffixed per-segment)
 *   - productType?: string                           (optional single-product run)
 *   - delivery?: 'per-segment'                       (only supported mode)
 */

// `validate` and `includeZeroFinancialRows` were historically read with
// `String(value || '').toLowerCase() === 'true'`. That silently dropped
// values like `'True '` (trailing whitespace from a config form), which
// in turn silently disabled Lloyd's V5.2 validation. The transform below
// trims before comparing so the boolean reflects intent, and rejects
// non-boolean / non-string values outright (a `1` from a producer that
// thinks "1 means true" surfaces as a parse error instead of `false`).
const flexBool = z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
        if (typeof v === 'boolean') return v;
        if (v === undefined) return undefined;
        return v.trim().toLowerCase() === 'true';
    });

const PayloadSchema = z.object({
    binderId: z.string().min(1),
    year: z.coerce.number().int().min(1970),
    month: z.coerce.number().int().min(1).max(12),
    stream: z.enum(['risk', 'premium', 'claims']),
    filenameBase: z.string().min(1),
    productType: z.string().optional(),
    correlationId: z.string().optional(),
    exportHash: z.string().optional(),
    validate: flexBool,
    includeZeroFinancialRows: flexBool,
});

const asNumber = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};
const isZeroFinancialPremiumRow = (row: Record<string, unknown>) => {
    const riskType = String(row['CR0022 Risk Transaction Type'] || '').trim();
    if (riskType !== 'Adjustment' && riskType !== 'Cancellation') return false;
    const keys = [
        'CR0059 Gross Premium Paid This Time',
        'CR0062 Commission Amount',
        'CR0064 Total Taxes and Levies',
        'CR0925 Total Fee Amount',
        'CR0065 Net Premium to London (Original Currency)',
        'CR0068 Net Premium to London (Settlement Currency)',
    ] as const;
    return keys.every((key) => {
        const n = asNumber((row as Record<string, unknown>)[key]);
        return n !== null && n === 0;
    });
};

async function resolveProductTypesForBinder(binderId: string, explicit?: string): Promise<string[]> {
    if (explicit) return [explicit];
    const auths = await tenantScopedPrisma.binderProductAuthority.findMany({
        where: { binderId, status: 'ACTIVE' },
        select: { productCode: true },
        orderBy: { productCode: 'asc' },
    });
    if (auths.length > 0) return auths.map((a) => a.productCode);
    throw new Error(`XLSX.GENERATE_BORDEREAUX_V52: binder ${binderId} has no active product authority rows`);
}

export const handleGenerateBordereauxV52: JobHandler = async (job: Job) => {
    const startedAt = Date.now();
    const data = PayloadSchema.parse(job.data);
    const correlationId = ensureCorrelationId(data.correlationId);
    const productTypeInput = data.productType?.trim().toUpperCase() || undefined;
    const delivery = 'per-segment';

    return runWithCorrelationId(correlationId, async () => runWithBinderOperatingTenant(data.binderId, async () => {
        logger.info({
            event: 'bdx.worker.started',
            jobId: job.id,
            binderId: data.binderId,
            year: data.year,
            month: data.month,
            stream: data.stream,
            productType: productTypeInput || 'all',
            exportHash: data.exportHash || undefined,
            delivery,
        }, 'bdx.worker.started');

        try {
            const { fetchLloydsV52BordereauxRows, validateLloydsV52RowsOrThrow } = await import('../../modules/reporting/domain/bordereaux/lloydsV52.js');

            const mustValidate = process.env.NODE_ENV === 'production'
                || String(process.env.BDX_VALIDATE_ALWAYS || '').trim().toLowerCase() === 'true'
                || data.validate === true;
            const includeZero = data.includeZeroFinancialRows === true;
            const suppressZeroRows = data.stream === 'premium' && !includeZero;

            const productTypes = await resolveProductTypesForBinder(data.binderId, productTypeInput);

            const fetchStartedAt = Date.now();
            const segments: Array<{ productType: string; rows: Record<string, unknown>[]; headers: string[] }> = [];
            for (const productType of productTypes) {
                if (!productType) {
                    throw new Error(`XLSX.GENERATE_BORDEREAUX_V52: resolveProductTypesForBinder returned empty productType for binder ${data.binderId}`);
                }
                const { rows, defaultHeaders } = await fetchLloydsV52BordereauxRows({
                    binderId: data.binderId,
                    year: data.year,
                    month: data.month,
                    stream: data.stream,
                    productCode: productType,
                });
                if (mustValidate) validateLloydsV52RowsOrThrow(data.stream, rows, undefined, productType);
                const filtered = suppressZeroRows
                    ? (rows as Array<Record<string, unknown>>).filter((row) => !isZeroFinancialPremiumRow(row))
                    : rows;
                segments.push({ productType, rows: filtered, headers: defaultHeaders as string[] });
            }

            const results: Array<{ filename: string; url: string; productType: string; rowCount: number }> = [];

            for (const seg of segments) {
                const buf = await writeBdxWorkbookBuffer({
                    stream: data.stream,
                    rows: seg.rows,
                    headers: seg.headers,
                    sheetName: data.stream.toUpperCase(),
                });
                const suffix = seg.productType ? `-${seg.productType}` : '';
                const up = await storageService.uploadFile(
                    buf,
                    `${data.filenameBase}${suffix}.xlsx`,
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                );
                results.push({
                    filename: up.filename,
                    url: up.url,
                    productType: seg.productType || 'all',
                    rowCount: seg.rows.length,
                });
            }

            logger.info({
                event: 'bdx.worker.completed',
                jobId: job.id,
                binderId: data.binderId,
                stream: data.stream,
                segments: segments.length,
                totalRows: segments.reduce((s, seg) => s + seg.rows.length, 0),
                exportHash: data.exportHash || undefined,
                durationMs: Date.now() - startedAt,
                fetchAndTransformDurationMs: Date.now() - fetchStartedAt,
                files: results.map((r) => r.filename),
                delivery,
            }, 'bdx.worker.completed');

            return results.length === 1
                ? { ...results[0], segments: results }
                : { segments: results };
        } catch (err) {
            logger.error({
                event: 'bdx.worker.failed',
                jobId: job.id,
                binderId: data.binderId,
                stream: data.stream,
                exportHash: data.exportHash || undefined,
                durationMs: Date.now() - startedAt,
                err,
            }, 'bdx.worker.failed');
            throw err;
        }
    }));
};

registerHandler('XLSX.GENERATE_BORDEREAUX_V52', handleGenerateBordereauxV52);
