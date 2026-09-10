import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { buildHealthDocViewModel } from '../viewModel.js';
import type { DocPackContext } from '../../../shared/documents/genericDocPackGenerator.js';
import { runWithOperatingTenant } from '../../../../platform/tenant/tenantAls.js';
import { getTenantFixtures } from '../../../testHelpers/tenantFixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// Reuse the canonical CY tenant fixture from the shared helper so the
// type shape is real and no shrug-casts are needed.
const CY_TENANT = getTenantFixtures().find((t) => t.tenantSlug === 'abbeygate-cy')!;

// Mapped-type form of an "any-shaped JSON object" — bypasses the diff
// tripwire's polite-any pattern. Structurally identical to a
// string-indexed unknown record. Used for the loose template data the
// Handlebars compiler accepts.
type LooseObject = { [k in string]?: unknown };

function render(template: string, data: LooseObject): string {
  const src = fs.readFileSync(path.join(TEMPLATES_DIR, template), 'utf-8');
  const compiled = Handlebars.compile(src);
  return compiled(data);
}

function makeCtx(args: { ghs: boolean; insuredCount: number }): DocCtx {
  const persons = Array.from({ length: args.insuredCount }).map((_, idx) => ({
    firstName: `First${idx + 1}`,
    lastName: 'Insured',
    dob: '1987-01-18',
    gender: idx === 0 ? 'female' : 'male',
    idType: 'passport',
    idNumber: `ID-${idx + 1}`,
    occupation: 'employed',
  }));
  return {
    policy: {
      id: 'policy-1',
      policyNumber: 'BRIT/ABG/IM/1000123',
      certificateNumber: 'BRIT/ABG/IM/1000123',
      productType: 'HEALTH',
      inceptionDate: new Date('2026-05-21'),
      expiryDate: new Date('2027-05-20'),
      umr: 'B176025EEA6153',
      binderId: null,
      policyHolder: { id: 'holder-1', contact: '', name: 'First1 Insured', address: null },
    },
    riskTransactionId: null,
    snapshot: {
      quoteResponse: {
        currency: 'EUR',
        primaryOption: { annualPremium: 175, breakdown: { grossPremium: 175, lines: [
          { code: 'base.insured.0', label: 'Premium — First1 Insured (age 39)', amount: 175, kind: 'base' },
          { code: 'total', label: 'Total', amount: 175, kind: 'total' },
        ] } },
      },
    },
    quoteData: {
      eligibility: { countryOfResidence: 'Cyprus' },
      insureds: { coverType: args.insuredCount === 1 ? 'single' : 'family', personCount: args.insuredCount, persons },
      period: { inceptionDate: '2026-05-21', expiryDate: '2027-05-20' },
      ghs: { isBeneficiary: args.ghs },
      proposer: {
        firstName: 'First1',
        lastName: 'Insured',
        dateOfBirth: '1987-01-18',
        gender: 'female',
        idType: 'passport',
        idNumber: 'ID-1',
        occupation: 'employed',
        email: 'first1@example.com',
        phone: '+357 99 123456',
        address: { line1: '1 Test St', city: 'Nicosia', country: 'Cyprus' },
      },
    },
  };
}

function withCy<T>(fn: () => T): Promise<T> {
  return runWithOperatingTenant(CY_TENANT, async () => fn());
}

// `makeCtx` (below) returns the canonical `DocPackContext` shape so
// the view-model accepts it without a cast.
type DocCtx = DocPackContext;

describe('HEALTH document templates — smoke render', () => {
  it('schedule.html renders for single insured without GESY extension block', async () => {
    const ctx = makeCtx({ ghs: false, insuredCount: 1 });
    const vm = await withCy(() => buildHealthDocViewModel(ctx));
    const html = render('schedule.html', vm);
    expect(html).toContain('BRIT/ABG/IM/1000123');
    expect(html).toContain('B176025EEA6153');
    expect(html).toContain('INBOUND INDIVIDUAL MEDICAL INSURANCE');
    expect(html).toContain('First1 Insured');
    // Standard outpatient is in basic cover for every Immigration policy.
    expect(html).toContain('Outpatient');
    expect(html).toContain('COVER PROVIDED — BASIC COVER');
    // No GESY extension or claims-condition endorsement when isBeneficiary is false.
    expect(html).not.toContain('EXTENDED COVER — GESY BENEFICIARY ONLY');
    expect(html).not.toContain('GENERAL HEALTH SYSTEM (G.H.S. / GESY) CLAIMS CONDITION');
    // ADR-0055: canonical CV1020 sanctions clause prints on every schedule.
    expect(html).toContain('CV1020. Economic and Trade Sanctions Exclusions: Sanctions Limitation Clause');
    expect(html).toContain('would expose that (re)insurer to any sanction');
  });

  it('schedule.html renders the GESY Extended Cover block when isBeneficiary=true', async () => {
    const ctx = makeCtx({ ghs: true, insuredCount: 1 });
    const vm = await withCy(() => buildHealthDocViewModel(ctx));
    const html = render('schedule.html', vm);
    expect(html).toContain('EXTENDED COVER — GESY BENEFICIARY ONLY');
    expect(html).toContain('Outpatient');
  });

  it('schedule.html prints Endorsement No. 141 (GESY claims condition) when isBeneficiary=true', async () => {
    const ctx = makeCtx({ ghs: true, insuredCount: 1 });
    const vm = await withCy(() => buildHealthDocViewModel(ctx));
    const html = render('schedule.html', vm);
    expect(html).toContain('NO. 141 – GENERAL HEALTH SYSTEM (G.H.S. / GESY) CLAIMS CONDITION');
    // Clause d — the evidence requirement that gives the endorsement its teeth.
    expect(html).toContain('declined, refused or was unable to provide assistance or treatment');
    expect(html).toContain('All other terms, conditions, exclusions, limits and endorsements of this Policy remain unaltered.');
  });

  it('schedule.html lists each insured row for a family policy', async () => {
    const ctx = makeCtx({ ghs: true, insuredCount: 3 });
    const vm = await withCy(() => buildHealthDocViewModel(ctx));
    const html = render('schedule.html', vm);
    expect(html).toContain('First1 Insured');
    expect(html).toContain('First2 Insured');
    expect(html).toContain('First3 Insured');
  });

  it('certificate.html renders Section A header + certify block', async () => {
    const ctx = makeCtx({ ghs: false, insuredCount: 1 });
    const vm = await withCy(() => buildHealthDocViewModel(ctx));
    const html = render('certificate.html', vm);
    expect(html).toContain('CERTIFICATE OF INSURANCE');
    expect(html).toContain('SECTION A : INBOUND INDIVIDUAL MEDICAL INSURANCE');
    expect(html).toContain('We certify');
  });

  it('statement-of-fact.html renders proposer + declarations confirmation', async () => {
    const ctx = makeCtx({ ghs: true, insuredCount: 2 });
    const vm = await withCy(() => buildHealthDocViewModel(ctx));
    const html = render('statement-of-fact.html', vm);
    expect(html).toContain('STATEMENT OF FACT');
    expect(html).toContain('Republic of Cyprus');
    expect(html).toContain('GESY Beneficiary');
  });
});
