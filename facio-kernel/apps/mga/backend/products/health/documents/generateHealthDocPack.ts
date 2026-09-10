import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateProductDocPack,
  type GenerateProductDocPackArgs,
  type ProductDocPackConfig,
  selectProductDocsFromContract,
} from '../../shared/documents/genericDocPackGenerator.js';
import { buildHealthDocViewModel } from './viewModel.js';
import { HEALTH_DOCUMENT_PACK_CONTRACT } from './documentPackContract.js';

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

const HEALTH_DOC_PACK_CONFIG: ProductDocPackConfig = {
  productType: 'HEALTH',
  templatesDir: TEMPLATES_DIR,
  buildViewModel: buildHealthDocViewModel,
  selectDocs: (ctx, args) => {
    const isDraft = args.docPack === 'DRAFT_POLICY_PACK' || args.docPack === 'QUOTE_PACK';
    return selectProductDocsFromContract(HEALTH_DOCUMENT_PACK_CONTRACT, ctx, args).map((spec) => ({
      ...spec,
      viewModelOverrides: { ...(spec.viewModelOverrides || {}), isDraft },
    }));
  },
};

/**
 * HEALTH product doc-pack entrypoint. Wired by the HEALTH runtime's
 * `wording.render` engine and reachable via the canonical
 * `DocumentService.generate` / `DOC.GENERATE_ISSUED_POLICY_PACK` worker.
 */
export async function executeHealthDocPackGeneration(args: GenerateProductDocPackArgs) {
  return generateProductDocPack(HEALTH_DOC_PACK_CONFIG, args);
}
