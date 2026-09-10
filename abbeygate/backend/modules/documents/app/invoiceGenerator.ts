import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';
import { renderHtmlToPdf, loadTemplate } from './pdfRenderer.js';
import { storageService } from '../../../platform/storage/service.js';

import { logger } from '../../../platform/utils/logger.js';
const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const __templatesDir = path.resolve(__moduleDir, '../../../products/motor/documents/templates');
// Define paths
const OUTPUT_DIR = path.resolve(process.cwd(), 'uploads/invoices');

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

type InvoiceLikeData = Record<string, unknown>;

export const generateInvoiceDocx = async (invoiceId: string, invoiceData: InvoiceLikeData): Promise<{ url: string; googleDocUrl?: string }> => {
    logger.info(`[InvoiceGen] Starting generation for invoice ${invoiceId}`);
    const currency = String(invoiceData?.currency || invoiceData?.Currency || 'EUR');
    const fmtMoney = (v: unknown) => {
        const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
        if (!Number.isFinite(n)) return String(v ?? '');
        return new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    };

    const invoiceNumber = String(invoiceData?.invoiceNumber || invoiceData?.InvoiceNumber || invoiceId);
    const invoiceDate = String(invoiceData?.invoiceDate || invoiceData?.Date || new Date().toLocaleDateString('en-GB'));
    const dueDate = String(invoiceData?.dueDate || invoiceData?.DueDate || '');
    const billToName = String(invoiceData?.client || invoiceData?.BillTo_Name || 'Valued Customer');
    const billToAddress = String(invoiceData?.address || invoiceData?.BillTo_Address || '');
    const reference = String(invoiceData?.reference || invoiceData?.Reference || invoiceId);
    const cover = String(invoiceData?.Cover || 'Motor Insurance');
    const period = String(invoiceData?.period || invoiceData?.Period || invoiceData?.period_range || '');

    const subtotalVal = invoiceData?.TotalPremium ?? invoiceData?.Subtotal ?? invoiceData?.subtotal ?? invoiceData?.amount ?? 0;
    const taxVal = invoiceData?.tax ?? invoiceData?.Tax ?? 0;
    const totalVal = invoiceData?.Total ?? invoiceData?.total ?? subtotalVal;

    const template = loadTemplate('invoice.html');
    const html = Handlebars.compile(template)({
        title: 'Invoice',
        documentLabel: 'Invoice #',
        invoiceNumber,
        invoiceDate,
        dueDate,
        billToName,
        billToAddress,
        reference,
        cover,
        currency,
        period,
        items: [
            { name: 'Premium', note: period ? `Period: ${period}` : '', amount: fmtMoney(subtotalVal) },
            ...(Number(taxVal) ? [{ name: 'Tax', note: '', amount: fmtMoney(taxVal) }] : []),
        ],
        subtotal: fmtMoney(subtotalVal),
        tax: fmtMoney(taxVal),
        total: fmtMoney(totalVal),
    });

    const baseHref = `file://${__templatesDir}/`;
    const htmlWithBase = html.replace('<head>', `<head><base href="${baseHref}">`);

    const buf = await renderHtmlToPdf({
        html: htmlWithBase,
        headerTemplate: '<div></div>',
        footerTemplate: '<div></div>',
    });

    const filename = `Invoice_${invoiceNumber}_${Date.now()}.pdf`;
    const uploaded = await storageService.uploadFile(buf, filename, 'application/pdf');
    return { url: uploaded.url };
};

export const generateReceiptDocx = async (invoiceId: string, invoiceData: InvoiceLikeData, paymentAmount: number, paymentDate: Date): Promise<{ url: string; googleDocUrl?: string }> => {
    logger.info(`[ReceiptGen] Starting generation for invoice ${invoiceId}`);

    try {
        const fmtMoney = (v: unknown) => {
            const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
            if (!Number.isFinite(n)) return String(v ?? '');
            return new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
        };

        const currency = String(invoiceData?.currency || invoiceData?.Currency || 'EUR');
        const invoiceNumber = String(invoiceData?.invoiceNumber || invoiceData?.InvoiceNumber || invoiceId);
        const invoiceDate = paymentDate.toLocaleDateString('en-GB');
        const dueDate = '';
        const billToName = String(invoiceData?.client || invoiceData?.BillTo_Name || 'Valued Customer');
        const billToAddress = String(invoiceData?.address || invoiceData?.BillTo_Address || '');
        const reference = String(invoiceData?.reference || invoiceData?.Reference || invoiceId);
        const cover = 'Payment Receipt';
        const period = '';

        const template = loadTemplate('invoice.html');
        const html = Handlebars.compile(template)({
            title: 'Payment Receipt',
            documentLabel: 'Receipt #',
            invoiceNumber,
            invoiceDate,
            dueDate,
            billToName,
            billToAddress,
            reference,
            cover,
            currency,
            period,
            items: [
                { name: 'Payment received', note: '', amount: fmtMoney(paymentAmount) },
            ],
            subtotal: fmtMoney(paymentAmount),
            tax: fmtMoney(0),
            total: fmtMoney(paymentAmount),
        });

        const baseHref = `file://${__templatesDir}/`;
        const htmlWithBase = html.replace('<head>', `<head><base href="${baseHref}">`);

        const buf = await renderHtmlToPdf({
            html: htmlWithBase,
            headerTemplate: '<div></div>',
            footerTemplate: '<div></div>',
        });

        const filename = `Receipt_${invoiceNumber}_${Date.now()}.pdf`;
        const uploaded = await storageService.uploadFile(buf, filename, 'application/pdf');
        return { url: uploaded.url };

    } catch (error) {
        logger.error({ err: error }, '[ReceiptGen] Error:');
        throw error;
    }
};
