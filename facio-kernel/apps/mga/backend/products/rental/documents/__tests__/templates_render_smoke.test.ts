import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { afterAll, describe, expect, it } from 'vitest';
import { closePdfBrowser, renderHtmlToPdf } from '../../../../modules/documents/app/pdfRenderer.js';

const TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'templates',
  'certificate.html',
);

describe('rental certificate template', () => {
  afterAll(async () => closePdfBrowser(), 30_000);

  it('renders a legible specimen PDF without carrier or ACORD claims', async () => {
    const html = Handlebars.compile(fs.readFileSync(TEMPLATE, 'utf8'))({
      tenantBrand: { displayName: 'Bonzah demo', legalName: 'Bonzah demo workspace' },
      issuedAt: 'Sep 09, 2026',
      policy: {
        number: 'BONZAH-DEMO-0001',
        transactionId: 'transaction-1',
        configurationVersion: 'bonzah-demo-2026.1',
      },
      insured: {
        name: 'Alex Morgan',
        address: '100 Demo Street, Denver, CO',
        email: 'alex@example.test',
        phone: '+1 555 0100',
      },
      rental: {
        start: 'Sep 18, 2026',
        end: 'Sep 22, 2026',
        pickup: 'Denver, CO, US',
        residence: 'CA, US',
        use: 'PERSONAL',
      },
      driver: {
        age: '32',
        licenceValid: 'Yes',
        additionalDrivers: [{ name: 'Jordan Lee', licenceState: 'CA' }],
      },
      vehicle: { description: '2025 Toyota RAV4', class: 'suv', declaredValue: '$31,500.00' },
      quote: { totalPremium: '$196.00', currency: 'USD' },
      coverage: {
        code: 'CDW',
        label: 'Collision Damage Waiver',
        limit: '$35,000',
        deductible: '$1,000',
        premium: '$96.00',
        description: 'Configured demonstration coverage.',
      },
    });
    expect(html).toContain('DEMO SPECIMEN');
    expect(html).toContain('grants no coverage');
    expect(html).not.toMatch(/ACORD|Auto Rental Insurance Group|Gary Osborne/);
    const pdf = await renderHtmlToPdf({
      html,
      margin: { top: '8mm', bottom: '10mm', left: '9mm', right: '9mm' },
    });
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10_000);
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
    const outputPath = process.env.RENTAL_CERTIFICATE_PDF_OUTPUT;
    if (outputPath) fs.writeFileSync(outputPath, pdf);
  }, 30_000);
});
