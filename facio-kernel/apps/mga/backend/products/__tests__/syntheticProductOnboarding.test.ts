import { describe, expect, it } from 'vitest';
import { ManifestRuntimeProductAdapter } from '../../modules/policy/domain/ManifestRuntimeProductAdapter.js';
import { defineProgrammeDefinitionEditor, type ProductRuntimeDefinition } from '../../modules/policy/domain/productRuntimeDefinition.js';
import { ProductRegistry } from '../../modules/policy/domain/ProductRegistry.js';
import { ValidationRegistry } from '@facio/validation/backend';
import type { ValidationProfile } from '@facio/validation';

describe('synthetic product onboarding', () => {
  it('supports a new product through runtime definition plus controlled extension only', async () => {
    const syntheticDefinition: ProductRuntimeDefinition = {
      productType: 'GADGET',
      displayName: 'Gadget Cover',
      executionMode: 'runtime_config',
      manifest: {
        productType: 'GADGET',
        displayName: 'Gadget Cover',
        insuredObject: {
          kind: 'device',
          cardinality: 'one',
          label: { singular: 'Device', plural: 'Devices' },
          fields: [
            { path: 'device.brand', label: 'Brand', type: 'text', required: true },
          ],
        },
        questionnaire: {
          sections: [
            {
              id: 'device',
              title: 'Device',
              order: 1,
              fields: [
                { path: 'device.brand', label: 'Brand', type: 'text', required: true },
                { path: 'device.value', label: 'Declared value', type: 'currency', required: true },
              ],
            },
          ],
        },
        summaryFields: {
          titlePaths: ['device.brand'],
          subtitlePaths: ['device.value'],
          insuredValuePath: 'device.value',
        },
        listColumns: {
          insured: { primaryPaths: ['device.brand'] },
          coverage: { primaryPaths: ['device.value'] },
        },
        coverageCatalog: [],
        uwConfigSchema: { groups: [] },
        documentTypes: { GADGET_SCHEDULE_PDF: 'Gadget Schedule' },
        riskModelHints: {
          requiredForUw: [{ path: 'device.brand', label: 'Brand' }, { path: 'device.value', label: 'Declared value' }],
          referralFlags: [],
          ratingInputs: [{ path: 'device.value', label: 'Declared value', format: 'currency' }],
        },
        rules: { batchRules: { minUnits: 0 } },
        theme: { iconKey: 'box', segmentLabel: 'Gadget' },
      },
      customerJourney: { pricingStep: 'device', uwStep: 'device', detailsStep: 'device' },
      intake: {
        publicSessionSlug: 'gadget',
        publicEntryPath: '/quote/gadget/new',
        firstStep: 'device',
        validationMode: 'manifest_only',
      },
      rating: {
        framework: 'unified-rating',
        mode: 'table_assets',
        source: 'deployed_asset',
        assetRefs: ['synthetic:gadget'],
        traceSchemaVersion: 'v1',
      },
      programmeDefinitionEditor: defineProgrammeDefinitionEditor({
        productType: 'GADGET',
        pricingModes: ['AUTOMATED'],
      }),
      engines: {
        rating: {
          engineId: 'gadget.synthetic.rating',
          kind: 'compiled',
          calculate: () => ({ premiumCalculation: { premium: 99, basis: 'FIXED', calculationDetails: { fixedAmount: 99, proRataFactor: 1 } } }),
          buildQuoteResponse: async () => ({
            quoteResponse: {
              status: 'QUOTED',
              currency: 'EUR',
              primaryOption: { annualPremium: 99 },
            },
          }),
          calculateEndorsementPremium: async () => ({ premium: 99, policyExcess: 0 }),
        },
        underwriting: {
          engineId: 'gadget.synthetic.uw',
          kind: 'compiled',
          evaluate: () => ({ decision: { lane: 'accept', reasons: [] }, analysis: { lane: 'accept', reasons: [] } }),
        },
        wording: {
          engineId: 'gadget.synthetic.wording',
          kind: 'compiled',
          getDocPackJobName: () => 'DOC.GENERATE_GADGET_DOC_PACK',
          render: async (args) => ({
            version: 1,
            documents: [{
              id: 'gadget-doc-1',
              type: 'GADGET_SCHEDULE_PDF',
              storageUri: `stub://gadget/${args.policyId}/schedule.pdf`,
              filename: 'gadget-schedule.pdf',
              status: 'GENERATED',
              version: 1,
              docPack: args.docPack,
              riskTransactionId: args.riskTransactionId ?? null,
            }],
          }),
        },
      },
      getDocPackJobName: () => 'DOC.GENERATE_GADGET_DOC_PACK',
      calculatePremium: () => ({ premium: 99, basis: 'FIXED', calculationDetails: { fixedAmount: 99, proRataFactor: 1 } }),
      buildQuoteResponse: async () => ({
        quoteResponse: {
          status: 'QUOTED',
          currency: 'EUR',
          primaryOption: { annualPremium: 99 },
        },
      }),
      validateBindRules: () => ({ valid: true, errors: [] }),
      normalizeUwData: (quoteData) => ({ normalizedQuoteData: quoteData as Record<string, unknown> }),
      buildVersionMeta: () => ({ sectionLabel: 'Gadget', coverageLabel: 'Gadget', insuredValueDisplay: '€99' }),
      buildVersionRows: () => ([{ section: 'Gadget', riskTransType: 'INCEPTION', limitText: '€99', excessText: '—', premium: 99, currency: 'EUR' }]),
      generateDocPack: async (args) => ({
        version: 1,
        documents: [{
          id: 'gadget-doc-1',
          type: 'GADGET_SCHEDULE_PDF',
          storageUri: `stub://gadget/${args.policyId}/schedule.pdf`,
          filename: 'gadget-schedule.pdf',
          status: 'GENERATED',
          version: 1,
          docPack: args.docPack,
          riskTransactionId: args.riskTransactionId ?? null,
        }],
      }),
      calculateEndorsementPremium: async () => ({ premium: 99, policyExcess: 0 }),
    };

    const adapter = new ManifestRuntimeProductAdapter(syntheticDefinition);
    ProductRegistry.getInstance().register(adapter);

    // Plug-and-play contract: every onboarded product MUST also register
    // a hand-authored `ValidationProfile`. This is the same step Motor /
    // Home / Travel perform in `backend/products/registerProducts.ts`.
    // No manifest-derived auto-defaults — `validateForContext` is the
    // single canonical authority and throws if the profile is missing
    // (Wave 5/A1).
    const gadgetProfile: ValidationProfile = {
      productCode: 'GADGET',
      fields: {
        'device.brand': { path: 'device.brand', requiredAtStages: ['bind', 'issuance'] },
        'device.value': { path: 'device.value', requiredAtStages: ['bind', 'issuance'] },
      },
      steps: [],
      stages: {
        bind: { fields: ['device.brand', 'device.value'] },
        issuance: { fields: ['device.brand', 'device.value'] },
      },
    };
    ValidationRegistry.register(gadgetProfile);

    expect(adapter.getRuntimeDefinition()?.intake.publicSessionSlug).toBe('gadget');
    expect(adapter.getQuoteReadyFieldKeys()).toEqual(expect.arrayContaining(['device.brand', 'device.value']));

    const validation = await adapter.validateForIssuance({ device: { brand: 'Acme' } });
    expect(validation.valid).toBe(false);
    expect(validation.missingForIssuedPack.map((item) => item.slug)).toContain('device.value');

    const quote = await adapter.buildQuoteResponse({ device: { brand: 'Acme', value: 1200 } }, {});
    expect(quote.quoteResponse.status).toBe('QUOTED');
  });
});
