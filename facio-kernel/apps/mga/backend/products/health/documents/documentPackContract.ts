import path from 'path';
import { fileURLToPath } from 'url';
import { healthManifest } from '@facio/products';
import {
  assertProductDocumentPackContract,
  type ProductDocumentPackContract,
} from '../../shared/documents/productDocumentPackContract.js';

const DOCS_DIR = path.dirname(fileURLToPath(import.meta.url));
const HEALTH_STATIC_DIR = path.join(DOCS_DIR, 'static');

/**
 * HEALTH document pack:
 *   - schedule.html         → dynamic Lloyd's jacket + Abbeygate sheet + insureds table
 *   - certificate.html      → dynamic Certificate of Insurance (Section A only)
 *   - statement-of-fact.html → dynamic statement of fact
 *   - BritImmigrationHealthIPID.pdf (static)
 *   - Abbeygate_Immigration_Health_Wording.pdf (static — approved wording
 *     dated 15 October 2025, supplied by Peter on 6 September 2026)
 *
 * IPID and wording are issued artefacts from BRIT — we ship them as
 * static PDFs in `static/` and let the doc-pack generator attach them
 * to issued packs and welcome emails alongside the dynamic schedule
 * and certificate.
 */
export const HEALTH_DOCUMENT_PACK_CONTRACT: ProductDocumentPackContract = {
  productType: 'HEALTH',
  entries: [
    {
      mode: 'template',
      docType: 'HEALTH_SCHEDULE_PDF',
      sourceId: 'health-schedule',
      sourceVersion: 'v3-cv1020-sanctions',
      label: healthManifest.documentTypes.HEALTH_SCHEDULE_PDF,
      filename: 'Health_Schedule_{policyNumber}.pdf',
      template: 'schedule.html',
      draftPrefix: true,
      endorsementVersionedFilename: true,
      assetVersion: 'health-schedule:v3-cv1020-sanctions',
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'DRAFT_POLICY_PACK', 'QUOTE_PACK', 'ENDORSEMENT_PACK'] },
    },
    {
      mode: 'template',
      docType: 'HEALTH_CERTIFICATE_PDF',
      sourceId: 'health-certificate',
      sourceVersion: 'v2',
      label: healthManifest.documentTypes.HEALTH_CERTIFICATE_PDF,
      filename: 'Health_Certificate_{policyNumber}.pdf',
      template: 'certificate.html',
      draftPrefix: true,
      assetVersion: 'health-certificate:v2',
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'DRAFT_POLICY_PACK', 'QUOTE_PACK'] },
      margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
    },
    {
      mode: 'template',
      docType: 'HEALTH_STATEMENT_OF_FACT_PDF',
      sourceId: 'health-statement-of-fact',
      sourceVersion: 'v2',
      label: healthManifest.documentTypes.HEALTH_STATEMENT_OF_FACT_PDF,
      filename: 'Health_Statement_of_Fact_{policyNumber}.pdf',
      template: 'statement-of-fact.html',
      assetVersion: 'health-statement-of-fact:v2',
      scope: { docPacks: ['ISSUED_POLICY_PACK'] },
    },
    {
      mode: 'staticPdf',
      docType: 'HEALTH_IPID_PDF',
      sourceId: 'health-ipid',
      sourceVersion: 'brit:2025:a379e7faa1e761aa',
      label: healthManifest.documentTypes.HEALTH_IPID_PDF,
      filename: 'Brit_Immigration_Health_IPID.pdf',
      staticPdfPath: path.join(HEALTH_STATIC_DIR, 'BritImmigrationHealthIPID.pdf'),
      assetVersion: 'brit-immigration-health-ipid:2025:a379e7faa1e761aa',
      scope: { docPacks: ['ISSUED_POLICY_PACK'] },
    },
    {
      mode: 'staticPdf',
      docType: 'HEALTH_POLICY_WORDING_PDF',
      sourceId: 'health-policy-wording',
      sourceVersion: 'brit:2025-10-15:c741cea9bcbfe975',
      label: healthManifest.documentTypes.HEALTH_POLICY_WORDING_PDF,
      filename: 'Brit_Immigration_Health_Policy_Wording.pdf',
      staticPdfPath: path.join(HEALTH_STATIC_DIR, 'Abbeygate_Immigration_Health_Wording.pdf'),
      assetVersion: 'brit-immigration-health-wording:2025-10-15:c741cea9bcbfe975',
      scope: { docPacks: ['ISSUED_POLICY_PACK'] },
    },
  ],
};

assertProductDocumentPackContract(HEALTH_DOCUMENT_PACK_CONTRACT, healthManifest.documentTypes);
