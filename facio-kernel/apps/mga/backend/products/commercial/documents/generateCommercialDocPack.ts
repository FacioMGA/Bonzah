import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProductDocPack, type GenerateProductDocPackArgs } from '../../shared/documents/genericDocPackGenerator.js';
import { buildCommercialDocViewModel } from './viewModel.js';
export async function executeCommercialDocPackGeneration(args: GenerateProductDocPackArgs) {
  return generateProductDocPack({ productType: 'COMMERCIAL', templatesDir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates'), buildViewModel: buildCommercialDocViewModel, selectDocs: (_context, options) => [{ docType: 'COMMERCIAL_SCHEDULE_PDF', sourceId: 'commercial-schedule', sourceVersion: 'v1', filename: 'commercial-policy-schedule.pdf', assetVersion: 'commercial-schedule-v1', template: 'schedule.html', viewModelOverrides: { isDraft: options.docPack === 'QUOTE_PACK' || options.docPack === 'DRAFT_POLICY_PACK' } }] }, { ...args, templateVersion: args.templateVersion ?? 'commercial-schedule-v1' });
}
