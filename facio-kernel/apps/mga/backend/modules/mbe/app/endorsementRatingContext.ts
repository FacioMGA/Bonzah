import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { resolveMappedProgramDefinition } from '../../programs/app/activeProgramDefinition.js';
import type { BuildQuoteResponseContext } from '../../policy/domain/productContracts.js';

/**
 * Resolves the same complete binder-authorised programme definition used by
 * the canonical quote spine before an MBE endorsement is repriced.
 */
export async function resolveEndorsementRatingContext(args: {
  productType: string;
  programId: string;
  binderId: string;
  requiresProgramRatingModel: boolean;
}): Promise<Pick<BuildQuoteResponseContext, 'ratingModel' | 'programDefinition'> | undefined> {
  if (!args.requiresProgramRatingModel) return undefined;
  if (!args.programId || !args.binderId) {
    throw new Error('Endorsement rating requires the policy program and binder authority.');
  }
  const authority = await tenantScopedPrisma.binderProductAuthority.findUnique({
    where: {
      binderId_productCode: {
        binderId: args.binderId,
        productCode: args.productType,
      },
    },
    select: { id: true },
  });
  if (!authority) throw new Error(`No binder product authority for ${args.productType} endorsement rating.`);
  const definition = await resolveMappedProgramDefinition({
    programId: args.programId,
    binderProductAuthorityId: authority.id,
  });
  if (!definition.ratingModel) {
    throw new Error(`${args.productType} endorsement rating requires an automated programme definition.`);
  }
  return {
    ratingModel: { ...definition.ratingModel, binderProductAuthorityId: definition.binderProductAuthorityId },
    programDefinition: {
      id: definition.id,
      programId: definition.programId,
      version: definition.version,
      pricingMode: definition.pricingMode,
      binderProductAuthorityId: definition.binderProductAuthorityId,
      underwriting: definition.underwriting,
      coverage: definition.coverage,
      questionnaire: definition.questionnaire,
      workflow: definition.workflow,
      channels: definition.channels,
      documents: definition.documents,
    },
  };
}
