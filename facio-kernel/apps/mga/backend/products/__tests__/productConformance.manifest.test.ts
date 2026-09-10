import { describe, expect, it } from 'vitest';
import { registerAllProducts } from '../registerProducts.js';
import { ProductRegistry } from '../../modules/policy/domain/ProductRegistry.js';
import type { IProductAdapter } from '../../modules/policy/domain/productContracts.js';
import fs from 'fs';
import { HOME_DOCUMENT_PACK_CONTRACT } from '../home/documents/documentPackContract.js';
import { MOTOR_DOCUMENT_PACK_CONTRACT } from '../motor/documents/documentPackContract.js';
import { TRAVEL_DOCUMENT_PACK_CONTRACT } from '../travel/documents/documentPackContract.js';
import { HEALTH_DOCUMENT_PACK_CONTRACT } from '../health/documents/documentPackContract.js';

registerAllProducts();

function questionnairePaths(adapter: IProductAdapter): Set<string> {
  const manifest = adapter.getManifest();
  return new Set(
    [
      ...manifest.questionnaire.sections.flatMap((section) => section.fields.map((field) => field.path)),
      ...manifest.insuredObject.fields.map((field) => field.path),
    ],
  );
}

function isDotPath(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(value);
}

describe('product manifest conformance', () => {
  const adapters = ProductRegistry.getInstance().getAllAdapters();
  const docPackContracts = new Map([
    ['HOME', { contract: HOME_DOCUMENT_PACK_CONTRACT }],
    ['MOTOR', { contract: MOTOR_DOCUMENT_PACK_CONTRACT }],
    ['TRAVEL', { contract: TRAVEL_DOCUMENT_PACK_CONTRACT }],
    ['HEALTH', { contract: HEALTH_DOCUMENT_PACK_CONTRACT }],
  ]);

  it('registers unique product types', () => {
    const productTypes = adapters.map((adapter) => adapter.productType);
    expect(productTypes.every((productType) => productType.trim().length > 0)).toBe(true);
    expect(new Set(productTypes).size).toBe(productTypes.length);
  });

  it.each(adapters)('has a coherent manifest for %s', (adapter) => {
    const manifest = adapter.getManifest();
    const sectionIds = manifest.questionnaire.sections.map((section) => section.id);
    const paths = questionnairePaths(adapter);
    const coverageCodes = manifest.coverageCatalog.map((item) => item.code);
    const documentTypes = new Set(Object.keys(adapter.getDocumentTypes()));
    const journey = adapter.getCustomerJourneyMeta();
    const acceptedJourneyIds = new Set([
      ...sectionIds,
      'your-quote',
      'your-details',
    ]);

    expect(sectionIds.length).toBeGreaterThan(0);
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
    expect([...paths].every(isDotPath)).toBe(true);
    expect(manifest.riskModelHints.requiredForUw.every((hint) => paths.has(hint.path))).toBe(true);
    expect(new Set(coverageCodes).size).toBe(coverageCodes.length);
    expect(documentTypes.size).toBeGreaterThan(0);

    const journeySteps = [journey.pricingStep, journey.uwStep, journey.detailsStep]
      .map((step) => String(step || '').trim())
      .filter(Boolean);
    expect(journeySteps.length).toBeGreaterThan(0);
    expect(journeySteps.every((step) => acceptedJourneyIds.has(step))).toBe(true);
  });

  it.each(adapters)('keeps %s document-pack capabilities aligned with its manifest', (adapter) => {
    const pack = docPackContracts.get(adapter.productType);
    if (!pack) return;
    const manifestDocTypes = adapter.getDocumentTypes();
    const contractDocTypes = pack.contract.entries.map((entry) => entry.docType);

    expect(new Set(contractDocTypes).size).toBe(contractDocTypes.length);
    expect(contractDocTypes.every((docType) => manifestDocTypes[docType])).toBe(true);
    expect(pack.contract.entries.every((entry) => entry.scope.docPacks.length > 0)).toBe(true);
  });

  it('uses only present, versioned static PDF assets in product document-pack contracts', () => {
    for (const { contract } of docPackContracts.values()) {
      for (const entry of contract.entries) {
        expect(entry.assetVersion.trim(), `${contract.productType}/${entry.docType} must have assetVersion`).not.toBe('');
        if (entry.mode === 'staticPdf') {
          expect(fs.existsSync(entry.staticPdfPath), `${contract.productType}/${entry.docType} missing ${entry.staticPdfPath}`).toBe(true);
        }
      }
    }
  });
});
