import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RentalCoverageCode } from '@facio/products';
import {
  generateProductDocPack,
  selectProductDocsFromContract,
  type GenerateProductDocPackArgs,
  type ProductDocPackConfig,
} from '../../shared/documents/genericDocPackGenerator.js';
import { RENTAL_DOCUMENT_PACK_CONTRACT } from './documentPackContract.js';
import {
  buildRentalCoverageViewModel,
  buildRentalDocViewModel,
  selectedRentalCertificateTypes,
} from './viewModel.js';

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

export const RENTAL_DOC_PACK_CONFIG: ProductDocPackConfig = {
  productType: 'RENTAL',
  templatesDir: TEMPLATES_DIR,
  buildViewModel: buildRentalDocViewModel,
  selectDocs: (ctx, args) => {
    const selectedTypes = selectedRentalCertificateTypes(ctx);
    return selectProductDocsFromContract(RENTAL_DOCUMENT_PACK_CONTRACT, ctx, args)
      .filter((spec) => selectedTypes.has(spec.docType))
      .map((spec) => {
        const coverageCode = String(
          spec.viewModelOverrides?.coverageCode || '',
        ) as RentalCoverageCode;
        return { ...spec, viewModelOverrides: buildRentalCoverageViewModel(ctx, coverageCode) };
      });
  },
};

export async function executeRentalDocPackGeneration(args: GenerateProductDocPackArgs) {
  return generateProductDocPack(RENTAL_DOC_PACK_CONFIG, {
    ...args,
    templateVersion: args.templateVersion ?? 'rental-demo-certificate-v1',
  });
}
