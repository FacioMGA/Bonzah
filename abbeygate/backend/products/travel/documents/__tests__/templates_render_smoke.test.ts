import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { afterAll, describe, expect, it } from 'vitest';

import { closePdfBrowser, renderHtmlToPdf } from '../../../../modules/documents/app/pdfRenderer.js';
import { buildTravelDocViewModel } from '../viewModel.js';
import { travelGoldenFixtures } from '../../goldenFixtures.js';
import type { DocPackContext } from '../../../shared/documents/genericDocPackGenerator.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';

// ADR-0019 — view model needs an operating tenant in scope. CY template
// smoke (€, Cyprus law, Nicosia complaints panel).
const cyTenant = getTenantFixtures().find((t) => t.countryCode === 'CY')!;
const runInCY = <T>(fn: () => T): T => runWithOperatingTenant(cyTenant, fn);

const TEMPLATES_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'templates');

function loadTravelTemplate(name: string): string {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf-8');
}

function isProbablyPdf(buf: Buffer) {
  return buf.subarray(0, 5).toString('utf8') === '%PDF-';
}

function buildCtx(): DocPackContext {
  const fixture = travelGoldenFixtures.minimumValid;
  const quoteData = {
    ...fixture,
    proposer: {
      ...(fixture.proposer as Record<string, unknown>),
      firstName: 'Andreas',
      lastName: 'Mappouras',
      email: 'andreas@example.com',
      phone: '+357 99 000000',
      address: {
        line1: 'M. Kousoulidi 4, Pera Chroio - Nisou',
        city: 'Nicosia',
        postcode: '2572',
        country: 'Cyprus',
      },
    },
    trip: {
      ...fixture.trip,
      planType: 'annual_multi_trip',
      destinations: ['europe'],
    },
    quote: { selectedPlan: 'gold', maxTripDays: 31 },
    travellers: {
      coverType: 'family',
      leadTravellerDOB: '1975-09-10',
      insuredPersons: [
        { name: 'Andreas Mappouras', dateOfBirth: '1975-09-10', preExistingMedical: 'No', medicalScreeningRef: 'N/A' },
        { name: 'Avgi Michail', dateOfBirth: '1980-12-22', preExistingMedical: 'No', medicalScreeningRef: 'N/A' },
        { name: 'George Mappouras', dateOfBirth: '2008-11-27', preExistingMedical: 'No', medicalScreeningRef: 'N/A' },
        { name: 'Eleana Mappouras', dateOfBirth: '2010-11-08', preExistingMedical: 'No', medicalScreeningRef: 'N/A' },
      ],
    },
  };
  return {
    policy: {
      id: 'policy-travel-1',
      policyNumber: 'DIRECT/BRIT/ABG/10000652',
      certificateNumber: null,
      productType: 'TRAVEL',
      inceptionDate: new Date('2026-04-07'),
      expiryDate: new Date('2027-04-06'),
      umr: 'B176023EEA6153',
      binderId: null,
      policyHolder: {
        id: 'holder-travel-1',
        name: 'Andreas Mappouras',
        address: 'M. Kousoulidi 4, Pera Chroio - Nisou, Nicosia, 2572, Cyprus',
        contact: JSON.stringify({ email: 'andreas@example.com', phone: '+357 99 000000' }),
      },
    },
    riskTransactionId: null,
    snapshot: {
      quoteData,
      quoteResponse: {
        currency: 'EUR',
        primaryOption: {
          netPremium: 172.19,
          iptAmount: 0,
          adminFee: 18,
          annualPremium: 190.19,
          breakdown: { netPremium: 172.19, iptAmount: 0, adminFee: 18, grossPremium: 190.19 },
        },
      },
    },
    quoteData,
  };
}

describe('Travel schedule template (smoke)', () => {
  afterAll(async () => {
    await closePdfBrowser();
  }, 30_000);

  it('renders the schedule template to a valid PDF with Lloyd\'s + Abbeygate brand assets inlined', async () => {
    const vm = runInCY(() => buildTravelDocViewModel(buildCtx()));
    const tpl = loadTravelTemplate('schedule.html');
    const html = Handlebars.compile(tpl)(vm);

    expect(html).toContain('assets/lloyds.svg');
    expect(html).toContain('assets/abbeygate.svg');
    expect(html).not.toContain('padding: 4px 0 0 0');
    expect(html).toContain('.legacy-page { background: #FFFFFF; }');
    // ── Page 1: Lloyd's policy jacket parity ──
    expect(html).toContain('Lloyd\'s Insurance Company S.A.');
    expect(html).toContain('LBS0004J');
    expect(html).toContain('Bastion Tower');
    // ── Page 2: schedule + insured persons ──
    expect(html).toContain('Abbeygate Your Travel');
    expect(html).toContain('The way insurance should be');
    expect(html).toContain('Coverholder Appointment Agreement Unique Market Reference (UMR):');
    expect(html).toContain('B176023EEA6153');
    expect(html).toContain('Policy Type Of Cover');
    expect(html).toContain('Date Of Issue');
    expect(html).toContain('Period of Insurance');
    expect(html).toContain('Area of Travel');
    expect(html).toContain('Level of Cover');
    expect(html).toContain('Maximum Trip Duration');
    expect(html).toContain('IMPORTANT NOTICE');
    expect(html).toContain('Andreas Mappouras');
    // ── Page 3: cover + general representative ──
    expect(html).toContain('Stephen Michaelides');
    expect(html).toContain('ABBEYGATE INSURANCE SERVICES LIMITED');
    expect(html).toContain('Type of Insurance');
    expect(html).toContain('Optional Extensions');
    // ── Page 4: wording / law / service of suit / claim ──
    expect(html).toContain('ABBEYGATE TRAVEL POLICY B1');
    expect(html).toContain('Service of Suit');
    expect(html).toContain('CYPRUS Law');
    expect(html).toContain('CEGA GROUP SERVICES');
    expect(html).toContain('LBS0006A');
    // ── Page 5: complaints ──
    expect(html).toContain('BGS.Complaints@Britinsurance.com');
    expect(html).toContain('Financial Ombudsman of the Republic of Cyprus');
    expect(html).toContain('LBS0038A');
    // ADR-0055: canonical CV1020 sanctions clause prints on every schedule.
    expect(html).toContain('CV1020. Economic and Trade Sanctions Exclusions: Sanctions Limitation Clause');
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

  it('renders the statement of fact template with travel declarations', () => {
    const vm = runInCY(() => buildTravelDocViewModel(buildCtx()));
    const tpl = loadTravelTemplate('statement-of-fact.html');
    const html = Handlebars.compile(tpl)(vm);

    expect(html).toContain('Statement of Fact');
    expect(html).toContain('Policy number: <strong>DIRECT/BRIT/ABG/10000652</strong>');
    expect(html).toContain('Medical notice accepted');
    expect(html).toContain('Andreas Mappouras');
    expect(html).toContain('Pre-existing medical conditions');
  });

  it('statement of fact carries the Abbeygate + Lloyd\'s brand topbar (ABY-269)', () => {
    // ABY-269 regression: the travel SoF previously shipped without
    // any brand identification, unlike every other Abbeygate-issued
    // document. The topbar uses the shared `.brand-topbar` styling
    // from `styles/pdf-theme.css`, which the PDF renderer inlines
    // alongside the SVG assets at render time.
    const vm = runInCY(() => buildTravelDocViewModel(buildCtx()));
    const tpl = loadTravelTemplate('statement-of-fact.html');
    const html = Handlebars.compile(tpl)(vm);

    expect(html).toContain('styles/pdf-theme.css');
    expect(html).toContain('class="brand-topbar avoid-break"');
    expect(html).toContain('assets/abbeygate.svg');
    expect(html).toContain('assets/lloyds.svg');
    expect(html).toContain('Abbeygate Travel Insurance');
  });
});
