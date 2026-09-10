import { motorManifest } from '@facio/products';
import {
  assertProductDocumentPackContract,
  requiredIssuedDocTypesFromContract,
  type ProductDocumentPackContract,
} from '../../shared/documents/productDocumentPackContract.js';
import { resolveMotorPolicyWording } from './policyWording.js';

const MOTOR_POLICY_WORDING_ANCHOR = resolveMotorPolicyWording('CY');

export const MOTOR_DOCUMENT_PACK_CONTRACT: ProductDocumentPackContract = {
  productType: 'MOTOR',
  entries: [
    {
      mode: 'template',
      docType: 'MOTOR_CERTIFICATE_PDF',
      label: motorManifest.documentTypes.MOTOR_CERTIFICATE_PDF,
      filename: 'Certificate_Motor_Policy{certificateNumber}-{policyNumber}.pdf',
      template: 'certificate.html',
      draftPrefix: true,
      assetVersion: 'motor-certificate:v2',
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'DRAFT_POLICY_PACK'], requiredForIssuedPack: true, emailAttachment: true },
      margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
    },
    {
      mode: 'template',
      docType: 'MOTOR_GREEN_CARD_PDF',
      label: motorManifest.documentTypes.MOTOR_GREEN_CARD_PDF,
      filename: 'Green_Card_Motor_Policy{certificateNumber}-{policyNumber}.pdf',
      template: 'green-card.html',
      draftPrefix: true,
      assetVersion: 'motor-green-card:v2',
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'DRAFT_POLICY_PACK'], requiredForIssuedPack: true, emailAttachment: true },
      margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
    },
    {
      mode: 'template',
      docType: 'MOTOR_SCHEDULE_PDF',
      label: motorManifest.documentTypes.MOTOR_SCHEDULE_PDF,
      filename: 'Schedule_of_Insurance_Motor-{policyNumber}.pdf',
      template: 'schedule.html',
      draftPrefix: true,
      endorsementVersionedFilename: true,
      assetVersion: 'motor-schedule:v3-cv1020-sanctions',
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'DRAFT_POLICY_PACK', 'ENDORSEMENT_PACK'], requiredForIssuedPack: true, emailAttachment: true },
      margin: { top: '12mm', bottom: '12mm', left: '6mm', right: '6mm' },
    },
    {
      mode: 'template',
      docType: 'MOTOR_STATEMENT_OF_FACT_PDF',
      label: motorManifest.documentTypes.MOTOR_STATEMENT_OF_FACT_PDF,
      filename: 'Statement_of_Fact_Motor_Policy{certificateNumber}-{policyNumber}.pdf',
      template: 'statement-of-fact.html',
      draftPrefix: true,
      assetVersion: 'motor-statement-of-fact:v1',
      scope: { docPacks: ['ISSUED_POLICY_PACK', 'DRAFT_POLICY_PACK'], requiredForIssuedPack: true, emailAttachment: true },
      margin: { left: '6mm', right: '6mm' },
    },
    {
      mode: 'staticPdf',
      docType: 'MOTOR_POLICY_WORDING_PDF',
      label: motorManifest.documentTypes.MOTOR_POLICY_WORDING_PDF,
      filename: MOTOR_POLICY_WORDING_ANCHOR.filename,
      staticPdfPath: MOTOR_POLICY_WORDING_ANCHOR.staticPdfPath,
      assetVersion: MOTOR_POLICY_WORDING_ANCHOR.assetVersion,
      scope: { docPacks: ['ISSUED_POLICY_PACK'], requiredForIssuedPack: true, emailAttachment: true },
    },
    {
      mode: 'template',
      docType: 'MOTOR_ENDORSEMENT_SCHEDULE_PDF',
      label: motorManifest.documentTypes.MOTOR_ENDORSEMENT_SCHEDULE_PDF,
      filename: 'Endorsements-{policyNumber}.pdf',
      template: 'endorsements.html',
      endorsementVersionedFilename: true,
      assetVersion: 'motor-endorsement-schedule:v2-cv1020-sanctions',
      scope: { docPacks: ['ENDORSEMENT_PACK'] },
      margin: { top: '12mm', bottom: '12mm', left: '6mm', right: '6mm' },
    },
  ],
};

assertProductDocumentPackContract(MOTOR_DOCUMENT_PACK_CONTRACT, motorManifest.documentTypes);

export const MOTOR_REQUIRED_ISSUED_DOC_TYPES = requiredIssuedDocTypesFromContract(MOTOR_DOCUMENT_PACK_CONTRACT);
