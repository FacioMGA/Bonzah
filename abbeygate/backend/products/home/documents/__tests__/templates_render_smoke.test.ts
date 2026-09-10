import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { afterAll, describe, expect, it } from 'vitest';

import { closePdfBrowser, renderHtmlToPdf } from '../../../../modules/documents/app/pdfRenderer.js';
import { buildHomeDocViewModel } from '../viewModel.js';
import { HOME_DOCUMENT_PACK_CONTRACT } from '../documentPackContract.js';
import { homeGoldenFixtures } from '../../goldenFixtures.js';
import type { DocPackContext } from '../../../shared/documents/genericDocPackGenerator.js';

const TEMPLATES_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'templates');

function loadHomeTemplate(name: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf-8');
}

function isProbablyPdf(buf: Buffer) {
  return buf.subarray(0, 5).toString('utf8') === '%PDF-';
}

function buildCtx(): DocPackContext {
  return {
    policy: {
      id: 'policy-home-1',
      policyNumber: 'BZ/ABG/00001753SSS',
      certificateNumber: null,
      productType: 'HOME',
      inceptionDate: new Date('2026-04-06'),
      expiryDate: new Date('2027-04-06'),
      umr: 'B176025EEA6551',
      binderId: null,
      policyHolder: {
        id: 'holder-home-1',
        name: 'Tim Mckeown',
        address: '9 Sea View Villas, Argaka, Paphos, 8873, Cyprus',
        contact: JSON.stringify({ email: 'tim.mckeown@example.com', phone: '+44 7711 287577' }),
      },
    },
    riskTransactionId: null,
    snapshot: {
      quoteData: {
        ...homeGoldenFixtures.minimumValid,
        coverage: {
          buildings: 320000,
          contents: 16300,
          accidentalDamageBuildings: false,
          accidentalDamageContents: false,
          allRiskJewellery: 0,
          allRiskOther: 0,
          solarPanels: 2000,
        },
      },
      quoteResponse: {
        currency: 'EUR',
        primaryOption: {
          netPremium: 374.09,
          iptAmount: 0,
          adminFee: 18,
          annualPremium: 392.09,
          breakdown: { netPremium: 374.09, iptAmount: 0, adminFee: 18, grossPremium: 392.09 },
        },
      },
    },
    quoteData: {
      ...homeGoldenFixtures.minimumValid,
      coverage: {
        buildings: 320000,
        contents: 16300,
        accidentalDamageBuildings: false,
        accidentalDamageContents: false,
        allRiskJewellery: 0,
        allRiskOther: 0,
        solarPanels: 2000,
      },
    },
  };
}

describe('Home schedule + statement-of-fact templates (smoke)', () => {
  afterAll(async () => {
    await closePdfBrowser();
  }, 30_000);

  it('reserves footer clearance for the schedule before generating a new document version', () => {
    const schedule = HOME_DOCUMENT_PACK_CONTRACT.entries.find(
      (entry) => entry.docType === 'HOME_SCHEDULE_PDF',
    );

    expect(schedule).toMatchObject({
      mode: 'template',
      assetVersion: 'home-schedule:v4-footer-clearance',
      margin: { bottom: '20mm' },
    });
  });

  it('renders the schedule template to a valid PDF with Lloyd\'s + Abbeygate brand assets inlined', async () => {
    const vm = buildHomeDocViewModel(buildCtx());
    const tpl = loadHomeTemplate('schedule.html');
    const html = Handlebars.compile(tpl)(vm);

    expect(html).toContain('assets/lloyds.svg');
    expect(html).toContain('assets/abbeygate.svg');
    expect(html).toContain('Lloyd\'s Insurance Company S.A.');
    // ── Page 1: Lloyd's policy jacket parity ──
    expect(html).toContain('LBS0004J');
    expect(html).toContain('682.594.839');
    expect(html).toContain('Bastion Tower');
    // ── Page 2: schedule + sums assured ──
    expect(html).toContain('Coverholder Appointment Agreement Unique Market Reference (UMR):');
    expect(html).toContain('B176025EEA6551');
    // Section codes are spans wrapped around the title — assert each part.
    expect(html).toContain('Buildings');
    expect(html).toContain('Contents in the home');
    expect(html).toContain('High Risk Items and personal effects');
    expect(html).toContain('Solar Panels');
    expect(html).toContain('Liability');
    expect(html).toContain('Emergency Travel');
    expect(html).toContain('European All Risks cover');
    expect(html).toContain('Outbuildings Max Limit');
    expect(html).toContain('Total Insured Value');
    expect(html).toContain('Property Type');
    expect(html).toContain('Villa');
    expect(html).toContain('Andrew Francis');
    // ── Page 3: maintenance ── (CSS text-transforms to UPPERCASE in PDF)
    expect(html).toContain('Maintenance and Checking Conditions');
    expect(html).toContain('well-maintained building');
    // ── Page 4: legal contacts ──
    expect(html).toContain("Marianna Papadakis");
    expect(html).toContain('Cypriot Law');
    // ── Page 5: endorsements ──
    expect(html).toContain('AB1');
    expect(html).toContain('AB14');
    expect(html).toContain('Specified Items on your Policy Number');
    // ADR-0055: canonical CV1020 sanctions clause prints on every schedule.
    expect(html).toContain('CV1020');
    expect(html).toContain('Sanctions Limitation Clause');
    expect(html).toContain('would expose that (re)insurer to any sanction');

    const pdf = await renderHtmlToPdf({
      html,
      headerTemplate: '<div></div>',
      footerTemplate: '<div></div>',
      margin: { top: '12mm', bottom: '12mm', left: '6mm', right: '6mm' },
    });

    expect(isProbablyPdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(10_000);
  }, 60_000);

  it('renders the statement-of-fact template to a valid PDF', async () => {
    const vm = buildHomeDocViewModel(buildCtx());
    const tpl = loadHomeTemplate('statement-of-fact.html');
    const html = Handlebars.compile(tpl)(vm);

    expect(html).toContain('STATEMENT OF FACT');
    expect(html).toContain('assets/lloyds.svg');
    expect(html).toContain('assets/abbeygate.svg');
    // Legacy parity sections
    expect(html).toContain('Proposer');
    expect(html).toContain('Property to be insured');
    expect(html).toContain('Type of Property');
    expect(html).toContain('Security');
    expect(html).toContain('Subsidence');
    expect(html).toContain('Details of any bank or mortgage interest');
    expect(html).toContain('Cover');
    expect(html).toContain('High Risk Items &amp; Personal Effects');
    expect(html).toContain('Notice');
    expect(html).toContain('Data Protection');
    expect(html).toContain('Insurance Administration');
    expect(html).toContain('Claims History');
    expect(html).toContain('Choice of Law');
    expect(html).toContain('Underinsurance');
    expect(html).toContain('Fraud Prevention');
    expect(html).toContain('Sensitive Data');
    expect(html).toContain('Marketing');

    const pdf = await renderHtmlToPdf({
      html,
      headerTemplate: '<div></div>',
      footerTemplate: '<div></div>',
      margin: { top: '12mm', bottom: '12mm', left: '6mm', right: '6mm' },
    });

    expect(isProbablyPdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(10_000);
  }, 60_000);
});
