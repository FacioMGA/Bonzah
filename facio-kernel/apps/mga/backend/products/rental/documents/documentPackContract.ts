import { rentalManifest } from '@facio/products';
import {
  assertProductDocumentPackContract,
  type ProductDocumentPackContract,
} from '../../shared/documents/productDocumentPackContract.js';

export const RENTAL_DOCUMENT_PACK_CONTRACT: ProductDocumentPackContract = {
  productType: 'RENTAL',
  entries: [
    {
      mode: 'template',
      docType: 'RENTAL_CDW_CERTIFICATE_PDF',
      sourceId: 'rental-demo-cdw-certificate',
      sourceVersion: 'v1',
      label: rentalManifest.documentTypes.RENTAL_CDW_CERTIFICATE_PDF,
      filename: 'Rental_CDW_Certificate_{policyNumber}.pdf',
      template: 'certificate.html',
      assetVersion: 'rental-demo-certificate:v1',
      viewModelOverrides: { coverageCode: 'CDW' },
      scope: { docPacks: ['ISSUED_POLICY_PACK'] },
      margin: { top: '8mm', bottom: '10mm', left: '9mm', right: '9mm' },
    },
    {
      mode: 'template',
      docType: 'RENTAL_RCLI_CERTIFICATE_PDF',
      sourceId: 'rental-demo-rcli-certificate',
      sourceVersion: 'v1',
      label: rentalManifest.documentTypes.RENTAL_RCLI_CERTIFICATE_PDF,
      filename: 'Rental_RCLI_Certificate_{policyNumber}.pdf',
      template: 'certificate.html',
      assetVersion: 'rental-demo-certificate:v1',
      viewModelOverrides: { coverageCode: 'RCLI' },
      scope: { docPacks: ['ISSUED_POLICY_PACK'] },
      margin: { top: '8mm', bottom: '10mm', left: '9mm', right: '9mm' },
    },
    {
      mode: 'template',
      docType: 'RENTAL_SLI_CERTIFICATE_PDF',
      sourceId: 'rental-demo-sli-certificate',
      sourceVersion: 'v1',
      label: rentalManifest.documentTypes.RENTAL_SLI_CERTIFICATE_PDF,
      filename: 'Rental_SLI_Certificate_{policyNumber}.pdf',
      template: 'certificate.html',
      assetVersion: 'rental-demo-certificate:v1',
      viewModelOverrides: { coverageCode: 'SLI' },
      scope: { docPacks: ['ISSUED_POLICY_PACK'] },
      margin: { top: '8mm', bottom: '10mm', left: '9mm', right: '9mm' },
    },
    {
      mode: 'template',
      docType: 'RENTAL_PAI_PEI_CERTIFICATE_PDF',
      sourceId: 'rental-demo-pai-pei-certificate',
      sourceVersion: 'v1',
      label: rentalManifest.documentTypes.RENTAL_PAI_PEI_CERTIFICATE_PDF,
      filename: 'Rental_PAI_PEI_Certificate_{policyNumber}.pdf',
      template: 'certificate.html',
      assetVersion: 'rental-demo-certificate:v1',
      viewModelOverrides: { coverageCode: 'PAI_PEI' },
      scope: { docPacks: ['ISSUED_POLICY_PACK'] },
      margin: { top: '8mm', bottom: '10mm', left: '9mm', right: '9mm' },
    },
  ],
};

assertProductDocumentPackContract(RENTAL_DOCUMENT_PACK_CONTRACT, rentalManifest.documentTypes);
