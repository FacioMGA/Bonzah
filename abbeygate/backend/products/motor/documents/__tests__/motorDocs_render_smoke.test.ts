import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { afterAll, describe, expect, it } from 'vitest';

import { calculateAutoInsuranceQuoteResponse } from '../../pricing/autoInsuranceCalculator.js';
import { TEST_QUOTE_DATA } from '../../../../platform/test/fixtures/testQuote.js';
import { buildDefaultProgramMbeProductConfig, buildMagicBSectionsForSchedule, resolveAppliedEndorsementsForQuote } from '../../../../modules/documents/app/programProduct.js';
import { closePdfBrowser, loadTemplate, renderHtmlToPdf } from '../../../../modules/documents/app/pdfRenderer.js';
import { buildMotorDocViewModel } from '../viewModel.js';
import { registerAllProducts } from '../../../registerProducts.js';

import { logger } from '../../../../platform/utils/logger.js';

registerAllProducts();

function isProbablyPdf(buf: Buffer) {
  return buf.subarray(0, 5).toString('utf8') === '%PDF-';
}

describe('motorDocs templates (smoke)', () => {
  afterAll(async () => {
    await closePdfBrowser();
  }, 30_000);

  it(
    'renders core templates to PDF buffers',
    async () => {
      // Use a "classic car" style snapshot so the Schedule resembles the Abbeygate reference PDF
      // (e.g., ABG001 appears, convertible excess can apply).
      const quoteDataForDocs: Record<string, unknown> = {
        ...TEST_QUOTE_DATA,
        cabrio: 'Yes',
        body_type: 'convertible',
        flags: { ...((TEST_QUOTE_DATA as { flags?: Record<string, unknown> }).flags || {}), classic_car: true },
      };

      const quoteResponse = calculateAutoInsuranceQuoteResponse(quoteDataForDocs, undefined, {
        reference: 'AQ-0000001',
        currency: 'EUR',
      });

      const policy = {
        id: 'policy_0000001',
        policyNumber: 'ABOLV0000001',
        inceptionDate: new Date('2026-01-01T00:00:00.000Z'),
        expiryDate: new Date('2027-01-01T00:00:00.000Z'),
        policyHolder: { name: 'Test Applicant Ltd' },
        binder: { agreementNumber: 'BINDER-0001' },
        umr: 'B0-0000001',
      };

      const snap: Record<string, unknown> = {
        quoteData: quoteDataForDocs,
        quoteResponse,
        certificateNumber: '825120993',
        umr: 'B0-0000001',
      };

      const templatesRoot = path.join(process.cwd(), '../templates');
      const assetsBasePath = `file://${templatesRoot}/`;

      const brand = {
        brokerDisplayName: 'Abbeygate Insurance Brokers Ltd',
        brokerLegalName: 'Abbeygate Insurance Brokers (Cyprus) Ltd',
        brokerRegulatoryLine: 'Authorised and regulated by the Insurance Companies Control Service (ICCS) License No. 6667',
        brokerAddressOneLine: '1 Abbeygate Street, Limassol, 3036, Cyprus',
        brokerAddressMultiline: '1 Abbeygate Street\nLimassol\n3036\nCyprus',
        dataControllerName: 'Abbeygate',
        uwTeamName: 'Abbeygate UW',
        coverholderStatement: "Abbeygate Insurance Brokers (Cyprus) Ltd is an authorised Lloyd’s Coverholder.",
        greenCardIssuerName: "Abbeygate Insurance Brokers Ltd on behalf of\nLloyd's Insurance Company S.A.",
        greenCardIssuerAddress: "Bastion Tower,\nMarsveldplein 5/Place du Champs de Mars 5,\n1050, Brussels, Belgium",
      };

      // Make the schedule preview realistic: compute coverages/conditions/assistance from MagicB.
      const cfg = buildDefaultProgramMbeProductConfig('abbeygate_motor');
      const applied = resolveAppliedEndorsementsForQuote({ quoteData: quoteDataForDocs, cfg });
      const mbeSections = buildMagicBSectionsForSchedule({ quoteData: quoteDataForDocs, applied });

      const vm = buildMotorDocViewModel({
        policy,
        snap,
        activeEndorsements: [],
        appliedEndorsements: applied,
        mbeSections,
        normalizedMbeCfg: {},
        greenCardSerial: '824692694',
        brand,
        assetsBasePath,
      });

      const writeArtifacts =
        process.env.DOCGEN_WRITE_ARTIFACTS === '1' || (!process.env.CI && process.env.DOCGEN_WRITE_ARTIFACTS !== '0');
      const outDir = path.join(process.cwd(), 'tmp', 'docgen', 'motorDocs');
      if (writeArtifacts) fs.mkdirSync(outDir, { recursive: true });

      const cases: Array<{ template: string; data: Record<string, unknown>; outBase: string; landscape?: boolean }> = [
        { template: 'schedule.html', data: vm, outBase: 'schedule' },
        { template: 'certificate.html', data: vm, outBase: 'certificate' },
        { template: 'green-card.html', data: vm, outBase: 'green_card' },
        { template: 'statement-of-fact.html', data: vm, outBase: 'statement_of_fact' },
        { template: 'invoice.html', data: vm, outBase: 'invoice' },
        { template: 'endorsements.html', data: vm, outBase: 'endorsements' },
      ];

      for (const c of cases) {
        const tpl = loadTemplate(c.template);
        const html = Handlebars.compile(tpl)(c.data);

        if (writeArtifacts) {
          const htmlPath = path.join(outDir, `${c.outBase}.html`);
          fs.writeFileSync(htmlPath, html, 'utf8');
        }

        const pdf = await renderHtmlToPdf({
          html,
          landscape: Boolean(c.landscape),
          headerTemplate: '<div></div>',
          footerTemplate: '<div></div>',
          margin: { top: '12mm', bottom: '12mm', left: '6mm', right: '6mm' },
        });

        expect(isProbablyPdf(pdf)).toBe(true);
        expect(pdf.length).toBeGreaterThan(10_000);

        if (writeArtifacts) {
          const pdfPath = path.join(outDir, `${c.outBase}.pdf`);
          fs.writeFileSync(pdfPath, pdf);
        }
      }

      if (writeArtifacts) {
        // Helpful when iterating locally
        logger.info(`[motorDocs] Wrote artifacts to ${outDir}`);
      }
    },
    120_000
  );
});

