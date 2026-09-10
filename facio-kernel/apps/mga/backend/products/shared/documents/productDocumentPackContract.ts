import path from 'path';
import type { DocPackKind } from './genericDocPackGenerator.js';

export type ProductDocumentPackMode = 'template' | 'staticPdf';

export type ProductDocumentPackScope = {
  docPacks: readonly DocPackKind[];
};

export type ProductDocumentPackBaseEntry = {
  docType: string;
  /** Product-owned rendering capability selected explicitly by a programme definition. */
  sourceId: string;
  /** Immutable version of the source capability selected by a programme definition. */
  sourceVersion: string;
  label: string;
  filename: string;
  scope: ProductDocumentPackScope;
  assetVersion: string;
};

export type ProductTemplateDocumentEntry = ProductDocumentPackBaseEntry & {
  mode: 'template';
  template: string;
  draftPrefix?: boolean;
  endorsementVersionedFilename?: boolean;
  viewModelOverrides?: Record<string, unknown>;
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  headerTemplate?: string;
  footerTemplate?: string;
};

export type ProductStaticPdfDocumentEntry = ProductDocumentPackBaseEntry & {
  mode: 'staticPdf';
  staticPdfPath: string;
};

export type ProductDocumentPackEntry =
  | ProductTemplateDocumentEntry
  | ProductStaticPdfDocumentEntry;

export type ProductDocumentPackContract = {
  productType: string;
  entries: readonly ProductDocumentPackEntry[];
};

/**
 * The static IPID asset declared by a product's document-pack contract, or
 * null when the product has none / its IPID is not a single static asset.
 * Generic over the contract shape (no product coupling). Products whose IPID
 * varies by territory (Home) resolve it themselves instead of using this.
 */
export function staticIpidAssetFromContract(
  contract: ProductDocumentPackContract,
): { absolutePath: string; filename: string } | null {
  const entry = contract.entries.find(
    (candidate) => candidate.mode === 'staticPdf' && candidate.docType.endsWith('_IPID_PDF'),
  );
  return entry && entry.mode === 'staticPdf'
    ? { absolutePath: entry.staticPdfPath, filename: entry.filename }
    : null;
}

export function assertProductDocumentPackContract(contract: ProductDocumentPackContract, manifestDocumentTypes: Record<string, string>): void {
  const seen = new Set<string>();
  for (const entry of contract.entries) {
    const prefix = `${contract.productType} document pack contract`;
    if (!entry.docType.trim()) throw new Error(`${prefix}: blank docType`);
    if (!entry.sourceId.trim()) throw new Error(`${prefix}: ${entry.docType} has no sourceId`);
    if (!entry.sourceVersion.trim()) throw new Error(`${prefix}: ${entry.docType} has no sourceVersion`);
    if (!manifestDocumentTypes[entry.docType]) {
      throw new Error(`${prefix}: ${entry.docType} is missing from manifest.documentTypes`);
    }
    if (seen.has(entry.docType)) throw new Error(`${prefix}: duplicate docType ${entry.docType}`);
    seen.add(entry.docType);
    if (!entry.assetVersion.trim()) throw new Error(`${prefix}: ${entry.docType} has no assetVersion`);
    if (!entry.filename.trim() || !entry.filename.endsWith('.pdf')) {
      throw new Error(`${prefix}: ${entry.docType} must declare a PDF filename`);
    }
    if (entry.mode === 'staticPdf') {
      if (!path.isAbsolute(entry.staticPdfPath)) {
        throw new Error(`${prefix}: ${entry.docType} staticPdfPath must be absolute`);
      }
      if (!entry.staticPdfPath.endsWith('.pdf')) {
        throw new Error(`${prefix}: ${entry.docType} staticPdfPath must point to a PDF`);
      }
    }
  }
}
