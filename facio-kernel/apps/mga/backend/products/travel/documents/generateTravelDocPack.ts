import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateProductDocPack,
  type GenerateProductDocPackArgs,
  type ProductDocPackConfig,
  selectProductDocsFromContract,
} from '../../shared/documents/genericDocPackGenerator.js';
import { buildTravelDocViewModel } from './viewModel.js';
import { TRAVEL_DOCUMENT_PACK_CONTRACT } from './documentPackContract.js';
import { resolveTravelIpid } from './ipid.js';

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

export const TRAVEL_DOC_PACK_CONFIG: ProductDocPackConfig = {
  productType: 'TRAVEL',
  templatesDir: TEMPLATES_DIR,
  buildViewModel: buildTravelDocViewModel,
  selectDocs: (ctx, args) => {
    const isDraft = args.docPack === 'DRAFT_POLICY_PACK' || args.docPack === 'QUOTE_PACK';
    return selectProductDocsFromContract(TRAVEL_DOCUMENT_PACK_CONTRACT, ctx, args).map((spec) => {
      if (spec.mode === 'staticPdf' && spec.docType === 'TRAVEL_IPID_PDF') {
        return { ...spec, ...resolveTravelIpid({ quoteData: ctx.quoteData }) };
      }
      return {
        ...spec,
        viewModelOverrides: { ...(spec.viewModelOverrides || {}), isDraft },
      };
    });
  },
};

/**
 * Travel product doc-pack entrypoint. Wired by the Travel runtime's
 * `wording.render` engine and reachable via the canonical
 * `DocumentService.generate` / `DOC.GENERATE_ISSUED_POLICY_PACK` worker.
 */
export async function executeTravelDocPackGeneration(args: GenerateProductDocPackArgs) {
  return generateProductDocPack(TRAVEL_DOC_PACK_CONFIG, args);
}
