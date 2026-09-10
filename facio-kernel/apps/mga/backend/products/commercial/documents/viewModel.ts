import type { DocPackContext } from '../../shared/documents/genericDocPackGenerator.js';
import { parsePublishedProductKit } from '../../../modules/programs/domain/productKit/productKit.js';
import { readInsuranceConfiguration } from '../../../modules/insuranceConfiguration/domain/runtimeConfiguration.js';
import { commercialRiskSchema } from '../pricing.js';
import type { JsonObject } from '../../../platform/types/json.js';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** All terms, prices and wording originate in the retained transaction snapshot. */
export function buildCommercialDocViewModel(ctx: DocPackContext): Record<string, unknown> {
  const definition = object(ctx.snapshot.programDefinition);
  const configuration = readInsuranceConfiguration(object(definition.workflow) as JsonObject);
  if (!configuration) throw new Error('Commercial schedule requires the retained programme product configuration.');
  const productKit = parsePublishedProductKit(object(definition.documents).productKit);
  const risk = commercialRiskSchema.parse(ctx.quoteData.commercial);
  const response = object(ctx.snapshot.quoteResponse), option = object(response.primaryOption);
  if (typeof response.currency !== 'string' || typeof option.annualPremium !== 'number') throw new Error('Commercial schedule requires the recorded quote premium and currency.');
  const sections = configuration.product.coverageSections;
  const clauses = Object.values(configuration.product.details.wordingClauses ?? {}).flat();
  const coverages = risk.coverages.map((selected) => {
    const section = sections.find((row) => (row.coverageName || row.classOfBusinessLabel || row.classOfBusinessKey) === selected.coverage);
    if (!section) throw new Error('Recorded commercial coverage is absent from its retained definition.');
    const selectedClauses = clauses.filter((clause) => clause.status === 'Active' && !section.excludedClauseIds.includes(clause.id) && (section.includedClauseIds.includes(clause.id) || (clause.coverageType === selected.coverage && clause.mode !== 'Conditional')));
    return { ...selected, territorialLimit: section.territorialLimit, notes: section.notes, clauses: selectedClauses.map(({ id, name, body, category }) => ({ id, name, body, category })) };
  });
  return { brand: productKit.brand, policyNumber: ctx.policy.policyNumber, productName: configuration.product.name, proposer: object(ctx.quoteData.proposer), term: object(ctx.quoteData.policy), coverages, premium: option.annualPremium, currency: response.currency, definitionId: definition.id, definitionVersion: definition.version };
}
