import { describe, expect, it } from 'vitest';
import type { DocPackContext } from '../../../shared/documents/genericDocPackGenerator.js';
import { goldenRentalQuote } from '../../goldenFixtures.js';
import { calculateRentalRating } from '../../pricing/calculator.js';
import { buildRentalCoverageViewModel, selectedRentalCertificateTypes } from '../viewModel.js';

function context(): DocPackContext {
  const rating = calculateRentalRating(goldenRentalQuote);
  return {
    policy: {
      id: 'policy-rental-1',
      policyNumber: 'BONZAH-DEMO-0001',
      certificateNumber: null,
      productType: 'RENTAL',
      inceptionDate: new Date(goldenRentalQuote.risk.rentalStart),
      expiryDate: new Date(goldenRentalQuote.risk.rentalEnd),
      umr: null,
      binderId: 'binder-rental-1',
      policyHolder: {
        id: 'holder-rental-1',
        name: 'Alex Morgan',
        address: '100 Demo Street, Denver, CO',
        contact: JSON.stringify({ email: 'alex@example.test', phone: '+1 555 0100' }),
      },
    },
    riskTransactionId: 'transaction-rental-1',
    snapshot: {
      quoteData: goldenRentalQuote,
      quoteResponse: { ...rating, currency: 'USD', ruleVersion: 'bonzah-demo-2026.1' },
      programDefinition: { version: 3 },
    },
    quoteData: goldenRentalQuote,
    documentSources: [],
  };
}

describe('rental certificate view model', () => {
  it('uses retained transaction fields for the selected coverage certificate', () => {
    const vm = buildRentalCoverageViewModel(context(), 'CDW');
    expect(vm.policy).toMatchObject({
      number: 'BONZAH-DEMO-0001',
      transactionId: 'transaction-rental-1',
      configurationVersion: 'bonzah-demo-2026.1',
    });
    expect(vm.insured).toMatchObject({ name: 'Alex Morgan', email: 'alex@example.test' });
    expect(vm.rental).toMatchObject({ start: 'Sep 18, 2026', end: 'Sep 22, 2026' });
    expect(vm.vehicle).toMatchObject({
      description: '2025 Toyota RAV4',
      declaredValue: '$31,500.00',
    });
    expect(vm.coverage).toMatchObject({
      code: 'CDW',
      limit: 'Up to $35,000 damage',
      deductible: 'Up to $1,000',
    });
  });

  it('selects one document type per purchased coverage', () => {
    const ctx = context();
    ctx.quoteData = { ...ctx.quoteData, coverages: ['CDW', 'RCLI'] };
    expect([...selectedRentalCertificateTypes(ctx)]).toEqual([
      'RENTAL_CDW_CERTIFICATE_PDF',
      'RENTAL_RCLI_CERTIFICATE_PDF',
    ]);
  });

  it('fails rather than inventing a coverage that is absent from the retained quote response', () => {
    const ctx = context();
    ctx.snapshot = { ...ctx.snapshot, quoteResponse: { coverages: [], currency: 'USD' } };
    expect(() => buildRentalCoverageViewModel(ctx, 'SLI')).toThrow(/retained quote coverage SLI/);
  });
});
