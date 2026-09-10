/**
 * Reconciliation Import Handler — Bank statement import logic.
 *
 * CHAMPS: Extracted from reconciliationRouter.ts to reduce god-file LOC.
 * Handles CSV/XLSX parsing, column mapping, transaction normalization,
 * and payment matching for imported bank statements.
 */

import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { storageService } from '../../../platform/storage/service.js';
import { addJobAndWait } from '../../../platform/events/queue.js';
import { parse as parseCsv } from 'csv-parse/sync';

import { logger } from '../../../platform/utils/logger.js';
import {
    errorMessage,
    sendError,
    requireTenantId,
    toRowMap,
    firstNonEmpty,
    parseAmount,
    parseDateMaybe,
    extractPolicyNumber,
    cleanNarrative,
} from './reconciliationUtils.js';

/**
 * POST /api/reconciliation/import
 * Import bank statement file (CSV or XLSX)
 */
export async function reconciliationImportHandler(req: Request, res: Response) {
    try {
        const tenantId = requireTenantId(req, res);
        if (!tenantId) return;
        const file = req.file;
        if (!file) return res.status(400).json({ success: false, error: { code: 'MISSING_FILE', message: 'Bank statement file is required' } });

        const filename = String(file.originalname || 'statement').trim();
        const isCsv = filename.toLowerCase().endsWith('.csv');

        const data: unknown[] = await (async () => {
            if (isCsv) {
                const text = Buffer.from(file.buffer).toString('utf-8');
                return parseCsv(text, {
                    columns: true,
                    delimiter: ';',
                    skip_empty_lines: true,
                    bom: true,
                    relax_column_count: true,
                    trim: true,
                }) as unknown[];
            }

            // XLSX parsing is isolated in the worker boundary to protect API process stability.
            const uploaded = await storageService.uploadFile(file.buffer, filename, file.mimetype || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            const parsed = await addJobAndWait<{ filename: string; rowCount: number }>(
                'XLSX.PARSE_FIRST_SHEET_TO_JSON',
                { sourceFilename: uploaded.filename },
                { timeoutMs: 120_000 }
            );
            const jsonFn = String(parsed?.filename || '').trim();
            const jsonStream = jsonFn ? await storageService.getFileStream(jsonFn) : null;
            if (!jsonStream) return [];
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
                jsonStream.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                jsonStream.on('end', () => resolve());
                jsonStream.on('error', reject);
            });
            const raw = Buffer.concat(chunks).toString('utf-8');
            try {
                const arr = JSON.parse(raw);
                return Array.isArray(arr) ? arr : [];
            } catch {
                return [];
            }
        })();

        // Capture all transactions with valid amount logic
        const transactions = data.filter((rawRow) => {
            const row = toRowMap(rawRow);
            const amountish = firstNonEmpty(row, [
                'credit',
                'debit',
                'amount',
                'money_in',
                'money_out',
                'value',
                'gross_amount',
                'net_amount',
                'transaction_amount',
                'amount_eur',
            ]);
            return amountish !== undefined && amountish !== null && String(amountish).trim() !== '';
        });

        if (transactions.length === 0) {
            return res.status(400).json({ success: false, error: { code: 'NO_ENTRIES', message: 'No valid transaction entries found. Please ensure file has columns: Credit/Debit, Amount, or Money In/Out.' } });
        }

        const results = [];
        for (const rawRow of transactions) {
            const row = toRowMap(rawRow);

            const narrative = String(firstNonEmpty(row, ['narrative', 'description', 'details', 'memo', 'merchant', 'merchant_name', 'card_acceptor']) || '');
            const gatewayContext = [
                firstNonEmpty(row, ['customername']),
                firstNonEmpty(row, ['accountholder']),
                firstNonEmpty(row, ['email']),
                firstNonEmpty(row, ['channelname']),
                firstNonEmpty(row, ['paymentmethod']),
                firstNonEmpty(row, ['paymenttype']),
                firstNonEmpty(row, ['transactionid']),
                firstNonEmpty(row, ['shortid']),
                firstNonEmpty(row, ['uniqueid']),
                firstNonEmpty(row, ['shopperid']),
                firstNonEmpty(row, ['invoiceid']),
            ]
                .filter(Boolean)
                .map((v) => String(v))
                .join(' ');
            const narrativeFull = String(narrative || gatewayContext || '');
            const payerRaw = String(firstNonEmpty(row, ['customername', 'accountholder', 'accountholder_name']) || '');
            const payer = cleanNarrative(payerRaw || narrativeFull || 'Direct Credit');

            const credit = parseAmount(firstNonEmpty(row, ['credit', 'money_in']));
            const debit = parseAmount(firstNonEmpty(row, ['debit', 'money_out']));
            const generic = parseAmount(firstNonEmpty(row, ['amount', 'value', 'gross_amount', 'net_amount', 'transaction_amount', 'amount_eur']));
            const finalAmount =
                credit !== null ? Math.abs(credit) :
                    debit !== null ? -Math.abs(debit) :
                        (generic !== null ? generic : 0);

            if (Math.abs(finalAmount) < 0.01) continue;

            const paymentDate =
                parseDateMaybe(firstNonEmpty(row, ['requesttimestamp', 'created_on', 'date', 'value_date', 'txn_date', 'transaction_date', 'posted_date'])) || new Date();

            const currency = String(firstNonEmpty(row, ['currency', 'ccy']) || '').trim().toUpperCase() || null;

            const refCheck =
                String(
                    firstNonEmpty(row, [
                        'payment_ref',
                        'reference',
                        'check_number',
                        'transaction_id',
                        'transactionid',
                        'uniqueid',
                        'shortid',
                        'invoiceid',
                        'payment_id',
                        'merchant_transaction_id',
                        'merchanttransactionid',
                        'checkout_id',
                        'checkoutid',
                        'rrn',
                        'arn',
                    ]) || ''
                ).trim();

            // Attempt to match imported line -> Payment/Policy (CardCorp exports + bank statements)
            let matchedPayment: Awaited<ReturnType<typeof tenantScopedPrisma.payment.findFirst>> = null;
            let matchedPolicyId: string | null = null;
            const candidates = [refCheck, narrativeFull, payer].filter(Boolean).map((s) => String(s));
            const policyNumber = extractPolicyNumber(candidates.join(' '));

            // 1) Try resolve by explicit payment identifiers
            for (const c of [refCheck]) {
                const v = String(c || '').trim();
                if (!v) continue;
                matchedPayment =
                    (await tenantScopedPrisma.payment.findFirst({ where: { paymentId: v, policy: { accountId: tenantId } } })) ||
                    (await tenantScopedPrisma.payment.findFirst({ where: { checkoutId: v, policy: { accountId: tenantId } } })) ||
                    (await tenantScopedPrisma.payment.findFirst({ where: { merchantTransactionId: v, policy: { accountId: tenantId } } })) ||
                    null;
                if (matchedPayment) break;
            }

            // 2) Try resolve by policyNumber embedded in narrative
            if (!matchedPayment && policyNumber) {
                const policy = await tenantScopedPrisma.policy.findFirst({
                    where: { policyNumber, accountId: tenantId },
                    select: { id: true },
                });
                if (policy?.id) matchedPolicyId = String(policy.id);
            }

            if (matchedPayment?.policyId) matchedPolicyId = String(matchedPayment.policyId);

            // 3) If we have a policy but no payment ID match, try best-effort match by policy+amount+date window
            if (!matchedPayment && matchedPolicyId) {
                const start = new Date(paymentDate);
                start.setDate(start.getDate() - 3);
                const end = new Date(paymentDate);
                end.setDate(end.getDate() + 3);
                matchedPayment = await tenantScopedPrisma.payment.findFirst({
                    where: {
                        policyId: matchedPolicyId,
                        policy: { accountId: tenantId },
                        amount: Math.abs(finalAmount),
                        createdAt: { gte: start, lte: end },
                    },
                    orderBy: { createdAt: 'desc' },
                });
            }

            if (!matchedPolicyId && matchedPayment?.policyId) matchedPolicyId = String(matchedPayment.policyId);

            const status =
                matchedPayment
                    ? (Math.abs(Number(matchedPayment.amount || 0) - Math.abs(finalAmount)) <= 1.0 ? 'MATCHED' : 'DISCREPANCY')
                    : 'UNAPPLIED';

            const rec = await tenantScopedPrisma.reconciliation.create({
                data: {
                    payer,
                    policyId: matchedPolicyId || undefined,
                    paymentId: matchedPayment?.id || undefined,
                    provider:
                        matchedPayment?.provider
                            ? String(matchedPayment.provider)
                            : (String(firstNonEmpty(row, ['source']) || '').trim() ? 'CARDCORP' : undefined),
                    currency: currency || matchedPayment?.currency || undefined,
                    direction: finalAmount > 0 ? 'CREDIT' : 'DEBIT',
                    paymentReference: (refCheck && refCheck !== 'N/A') ? refCheck : String(firstNonEmpty(row, ['transactionid', 'uniqueid', 'shortid']) || `REC-[${Math.floor(Math.random() * 1000000)}]`),
                    paymentAmount: finalAmount,
                    paymentDate,
                    paymentMethod: String(firstNonEmpty(row, ['paymentmethod']) || (finalAmount > 0 ? 'CARD' : 'CARD')),
                    status,
                    matchedAmount: matchedPayment ? matchedPayment.amount : 0,
                    exceptionNotes: narrativeFull || 'Imported',
                    raw: rawRow && typeof rawRow === 'object' ? rawRow : {},
                } as unknown as Prisma.ReconciliationUncheckedCreateInput,
            });
            results.push(rec);
        }

        return res.json({
            success: true,
            data: results,
            message: `Successfully processed ${file.originalname} and imported ${results.length} bank lines.`
        });
    } catch (error) {
        logger.error({ err: error }, 'Import bank statement error:');
        return sendError(res, 500, 'IMPORT_ERROR', errorMessage(error, 'Import failed'));
    }
}
