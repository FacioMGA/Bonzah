import path from 'path';
import { fileURLToPath } from 'url';
import { travelManifest } from '@facio/products';
import { TRAVEL_IPID_ASSETS } from './ipid.js';
import {
  assertProductDocumentPackContract,
  type ProductDocumentPackContract,
} from '../../shared/documents/productDocumentPackContract.js';

const DOCS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TRAVEL_STATIC_DIR = path.join(DOCS_DIR, 'static');

export const TRAVEL_DOCUMENT_PACK_CONTRACT: ProductDocumentPackContract = {
  productType: 'TRAVEL',
  entries: [
    {
      mode: 'template',
      docType: 'TRAVEL_CERTIFICATE_PDF',
      sourceId: 'travel-certificate',
      sourceVersion: 'v1',
      label: travelManifest.documentTypes.TRAVEL_CERTIFICATE_PDF,
      filename: 'Travel_Certificate_{policyNumber}.pdf',
      template: 'certificate.html',
      draftPrefix: true,
      assetVersion: 'travel-certificate:v1',
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'DRAFT_POLICY_PACK', 'QUOTE_PACK'] },
      margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
    },
    {
      mode: 'template',
      docType: 'TRAVEL_SCHEDULE_PDF',
      sourceId: 'travel-schedule',
      sourceVersion: 'v3-cv1020-sanctions',
      label: travelManifest.documentTypes.TRAVEL_SCHEDULE_PDF,
      filename: 'Travel_Schedule_{policyNumber}.pdf',
      template: 'schedule.html',
      draftPrefix: true,
      endorsementVersionedFilename: true,
      assetVersion: 'travel-schedule:v3-cv1020-sanctions',
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'DRAFT_POLICY_PACK', 'QUOTE_PACK', 'ENDORSEMENT_PACK'] },
    },
    {
      mode: 'template',
      docType: 'TRAVEL_STATEMENT_OF_FACT_PDF',
      sourceId: 'travel-statement-of-fact',
      sourceVersion: 'v1',
      label: travelManifest.documentTypes.TRAVEL_STATEMENT_OF_FACT_PDF,
      filename: 'Travel_Statement_of_Fact_{policyNumber}.pdf',
      template: 'statement-of-fact.html',
      assetVersion: 'travel-statement-of-fact:v1',
      scope: { docPacks: ['ISSUED_POLICY_PACK'] },
    },
    {
      // Anchor only. The generator resolves the exact trip-type asset from
      // immutable quote data using resolveTravelIpid (ADR-0099).
      mode: 'staticPdf',
      docType: 'TRAVEL_IPID_PDF',
      sourceId: 'travel-ipid-by-trip-type',
      sourceVersion: 'adr-0099:v1',
      label: travelManifest.documentTypes.TRAVEL_IPID_PDF,
      ...TRAVEL_IPID_ASSETS.single_trip,
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'QUOTE_PACK'] },
    },
    {
      mode: 'staticPdf',
      docType: 'TRAVEL_POLICY_WORDING_PDF',
      sourceId: 'travel-policy-wording',
      sourceVersion: 'brit:2026-08-24',
      label: travelManifest.documentTypes.TRAVEL_POLICY_WORDING_PDF,
      filename: 'Travel_Policy_Wording.pdf',
      staticPdfPath: path.join(TRAVEL_STATIC_DIR, 'Brit_Travel_Policy_Wording_Amended_Clean.pdf'),
      assetVersion: 'brit-travel-policy-wording:2026-08-24',
      // Danny 2026-09-03: a Travel quotation is a customer decision pack, so
      // it must include the same approved policy wording as the issued pack.
      // `sendRevisedQuoteUseCase` generates this canonical QUOTE_PACK; do not
      // attach the wording from a separate email-only path.
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'QUOTE_PACK'] },
    },
    {
      mode: 'template',
      docType: 'TRAVEL_MEDICAL_CARD_PDF',
      sourceId: 'travel-medical-card',
      sourceVersion: 'v1',
      label: travelManifest.documentTypes.TRAVEL_MEDICAL_CARD_PDF,
      filename: 'Travel_Medical_Assistance_Card_{policyNumber}.pdf',
      template: 'medical-card.html',
      assetVersion: 'travel-medical-assistance-card:v1',
      scope: { docPacks: ['ISSUED_POLICY_PACK'] },
      margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
    },
  ],
};

assertProductDocumentPackContract(TRAVEL_DOCUMENT_PACK_CONTRACT, travelManifest.documentTypes);
