import type { DocumentPack } from '../contracts/documents.js';

/** Explicit opt-in only. This is not a customer certificate, legal wording or insurer approval. */
export const syntheticDocumentPack: DocumentPack = {
  id: 'synthetic_transaction_pack',
  version: '1.0.0',
  name: 'Synthetic transaction evidence',
  rendererVersion: 'insurance-document-v1',
  evidenceBoundary: 'synthetic_training',
  issuerLabel: 'Facio Platform sandbox',
  legalRole: 'training_document_generator_not_insurer',
  sourceRefs: ['fixture://document-training/pack-v1'],
  templates: [
    {
      id: 'transaction_summary',
      version: '1.0.0',
      title: 'Insurance transaction summary',
      kind: 'transaction_summary',
      sourceRefs: ['fixture://document-training/summary-v1'],
      legalRefs: ['fixture://document-training/no-legal-authority'],
      wording:
        'Synthetic training document. This records a sandbox transaction only. It is not a policy, certificate of insurance, offer of coverage, evidence of payment or customer-approved wording.',
    },
    {
      id: 'coverage_schedule',
      version: '1.0.0',
      title: 'Coverage and financial schedule',
      kind: 'coverage_schedule',
      sourceRefs: ['fixture://document-training/schedule-v1'],
      legalRefs: ['fixture://document-training/no-legal-authority'],
      wording:
        'Amounts and coverage selections below reproduce the retained sandbox transaction. They establish no insurer obligation. Commission is calculated separately and does not establish a receivable, payment or balanced ledger.',
    },
  ],
};
