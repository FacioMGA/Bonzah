import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateProductDocPack,
  type GenerateProductDocPackArgs,
  type ProductDocPackConfig,
  selectProductDocsFromContract,
} from '../../shared/documents/genericDocPackGenerator.js';
import { buildHomeDocViewModel } from './viewModel.js';
import { HOME_DOCUMENT_PACK_CONTRACT } from './documentPackContract.js';
import { resolveHomePolicyWording, resolveHomeWordingDomicile, resolveHomeIpid } from './policyWording.js';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');

const HOME_DOC_PACK_CONFIG: ProductDocPackConfig = {
  productType: 'HOME',
  templatesDir: TEMPLATES_DIR,
  buildViewModel: buildHomeDocViewModel,
  selectDocs: (ctx, args) => {
    const isDraft = args.docPack === 'DRAFT_POLICY_PACK' || args.docPack === 'QUOTE_PACK';
    const countryCode = getTenantConfig().countryCode;
    // ADR-0048 — resolve the correct Lloyd's Home wording (tenant territory ×
    // client domicile) and IPID (tenant territory) for this policy, replacing
    // the contract's anchors. Both fail loud for unconfigured territories
    // rather than emitting another country's document.
    const wording = resolveHomePolicyWording(countryCode, resolveHomeWordingDomicile(ctx.quoteData));
    const ipid = resolveHomeIpid(countryCode);
    return selectProductDocsFromContract(HOME_DOCUMENT_PACK_CONTRACT, ctx, args).map((spec) => {
      if (spec.mode === 'staticPdf' && spec.docType === 'HOME_POLICY_WORDING_PDF') {
        return { ...spec, filename: wording.filename, staticPdfPath: wording.staticPdfPath, assetVersion: wording.assetVersion };
      }
      if (spec.mode === 'staticPdf' && spec.docType === 'HOME_IPID_PDF') {
        return { ...spec, filename: ipid.filename, staticPdfPath: ipid.staticPdfPath, assetVersion: ipid.assetVersion };
      }
      return {
        ...spec,
        viewModelOverrides: { ...(spec.viewModelOverrides || {}), isDraft },
      };
    });
  },
};

/**
 * Home product doc-pack entrypoint. Wired by the Home runtime's
 * `wording.render` engine and reachable via the canonical
 * `DocumentService.generate` / `DOC.GENERATE_ISSUED_POLICY_PACK` worker.
 */
export async function executeHomeDocPackGeneration(args: GenerateProductDocPackArgs) {
  return generateProductDocPack(HOME_DOC_PACK_CONFIG, args);
}
