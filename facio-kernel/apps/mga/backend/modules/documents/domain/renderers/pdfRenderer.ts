import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
type DocumentFileMetadata = import('../types.js').DocumentFileMetadata;
type kEndorsement = import('../types.js').kEndorsement;

import { logger } from '../../../../platform/utils/logger.js';
type ScheduleRenderData = {
    policyNumber?: string;
    policyHolder?: { name?: string };
    premium?: { total?: number | null };
    coverages?: unknown[];
    endorsements?: Array<
        Pick<kEndorsement, 'code'> &
        Partial<Pick<kEndorsement, 'title' | 'status' | 'params' | 'legalText' | 'documentRef'>>
    >;
};

export class PdfRenderer {

    static async renderSchedule(data: ScheduleRenderData): Promise<DocumentFileMetadata> {
        // Fix for ESM: define __dirname-like behavior
        const __filename = new URL(import.meta.url).pathname;
        const __dirname = path.dirname(__filename);
        const templatePath = path.resolve(__dirname, '../templates/schedule.html');
        let html = fs.readFileSync(templatePath, 'utf8');

        // Simple Replacement (In real app, use Handlebars or Mustache)
        html = html.replace('{{policyNumber}}', String(data.policyNumber || ''))
            .replace('{{policyHolderName}}', String(data.policyHolder?.name || ''))
            .replace('{{totalPremium}}', String(data.premium?.total?.toFixed(2) || '0.00'));

        // Add dynamic rows for coverages/endorsements (Stub logic)
        const coveragesHtml = data.coverages?.map((c) => {
            const rec = c as Record<string, unknown>;
            return `<tr><td>${String(rec.name || '')}</td><td>${String(rec.limit || '')}</td></tr>`;
        }).join('') || '';
        html = html.replace('{{coverageRows}}', coveragesHtml);

        return this.generatePdf(html, `schedule_${data.policyNumber}.pdf`);
    }

    static async renderEndorsements(data: Pick<ScheduleRenderData, 'endorsements' | 'policyNumber'>): Promise<DocumentFileMetadata | undefined> {
        if (!data.endorsements || data.endorsements.length === 0) return undefined;

        // Base styles for the endorsements document
        const styles = `
            <style>
                body { font-family: 'Helvetica', 'Arial', sans-serif; font-size: 12px; line-height: 1.5; color: #333; margin: 40px; }
                h1 { font-size: 24px; font-weight: bold; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 10px; }
                .endorsement-item { margin-bottom: 30px; page-break-inside: avoid; border-bottom: 1px solid #eee; padding-bottom: 20px; }
                .endorsement-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 15px; }
                .endorsement-title { font-size: 16px; font-weight: bold; color: #000; }
                .endorsement-code { font-family: monospace; font-size: 14px; font-weight: bold; color: #666; }
                .endorsement-text { text-align: justify; white-space: pre-wrap; }
                .endorsement-params { margin-top: 10px; background: #f9f9f9; padding: 10px; border-left: 3px solid #ccc; font-size: 11px; }
                .param-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
                .param-key { font-weight: bold; color: #555; }
            </style>
        `;

        const itemsHtml = data.endorsements.map((e) => {
            // Format parameters for display if they exist
            const paramsHtml = e.params && Object.keys(e.params).length > 0
                ? `<div class="endorsement-params">
                    ${Object.entries(e.params).map(([k, v]) => `
                        <div class="param-row">
                            <span class="param-key">${k.replace(/_/g, ' ').toUpperCase()}:</span>
                            <span>${v}</span>
                        </div>
                    `).join('')}
                   </div>`
                : '';

            // Use legalText if available, otherwise fallback to title/text logic
            const bodyText = e.legalText || "No legal text available.";

            // Status Badge
            const statusHtml = e.status && e.status !== 'APPLIED' && e.status !== 'BOUND'
                ? `<span style="background: #e5e7eb; color: #374151; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; margin-left: 10px; border: 1px solid #d1d5db;">${e.status}</span>`
                : '';

            return `
                <div class="endorsement-item">
                    <div class="endorsement-header">
                        <div>
                            <span class="endorsement-title">${String(e.title || e.code || 'Endorsement')}</span>
                            ${statusHtml}
                        </div>
                        <span class="endorsement-code">${e.code}</span>
                    </div>
                    <div class="endorsement-text">${bodyText}</div>
                    ${paramsHtml}
                </div>
            `;
        }).join('');

        const html = `
            <html>
            <head>${styles}</head>
            <body>
                <h1>Endorsements Schedule</h1>
                <p><strong>Policy Number:</strong> ${data.policyNumber}</p>
                <p><strong>Attached to and forming part of the Policy.</strong></p>
                <br/>
                ${itemsHtml}
            </body>
            </html>
        `;

        return this.generatePdf(html, `endorsements_${data.policyNumber}.pdf`);
    }

    private static async htmlToPdfBuffer(html: string): Promise<Buffer> {
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

        const browser = await puppeteer.launch({
            executablePath,
            // Azure App Service container environments typically require no-sandbox.
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                // /dev/shm is often tiny in containers; avoid crashes/hangs.
                '--disable-dev-shm-usage',
            ],
        });

        try {
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });
            const pdf = await page.pdf({
                format: 'A4',
                printBackground: true,
            });
            return Buffer.from(pdf);
        } finally {
            await browser.close();
        }
    }

    private static async generatePdf(html: string, filename: string): Promise<DocumentFileMetadata> {
        // Ensure output dir
        const outputDir = path.resolve(process.cwd(), 'uploads/documents');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);

        try {
            const buffer = await this.htmlToPdfBuffer(html);

            fs.writeFileSync(outputPath, buffer);

            return {
                name: filename,
                storageKey: `local/documents/${filename}`, // Mock S3 key
                sha256: 'mock-sha256', // In real app, calculate hash
                pages: 1, // Mock
                sizeBytes: buffer.length,
                contentType: 'application/pdf',
                createdAt: new Date().toISOString()
            };
        } catch (e) {
            logger.error({ err: e }, "PDF Generation failed");
            throw e;
        }
    }
}
