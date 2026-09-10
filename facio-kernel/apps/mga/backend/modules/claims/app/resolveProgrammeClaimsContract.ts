import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { resolveMappedProgramDefinition } from '../../programs/app/activeProgramDefinition.js';
import { ClaimsProgrammeConfigurationError, resolveClaimsContractFromProgram } from '../domain/claimsContract.js';

/**
 * Canonical application boundary for policy-specific claims behaviour.
 *
 * It resolves the same published, binder-authorised programme definition used
 * by quote and issue paths, then delegates claims semantics to the claims
 * domain. Program.metadata is deliberately not part of this path.
 */
export async function resolveProgrammeClaimsContract(args: {
  policyId: string;
  programId: string | null | undefined;
  binderId: string | null | undefined;
  productType: string | null | undefined;
}) {
  const policyId = String(args.policyId || '').trim();
  const programId = String(args.programId || '').trim();
  const binderId = String(args.binderId || '').trim();
  const productType = String(args.productType || '').trim().toUpperCase();
  if (!policyId || !programId || !binderId || !productType) {
    throw new ClaimsProgrammeConfigurationError(
      `Policy ${policyId || '(missing)'} requires programme, binder and product before claims behaviour can be resolved.`,
    );
  }

  const authority = await tenantScopedPrisma.binderProductAuthority.findUnique({
    where: { binderId_productCode: { binderId, productCode: productType } },
    select: { id: true },
  });
  if (!authority) {
    throw new ClaimsProgrammeConfigurationError(
      `Policy ${policyId} has no binder-product authority for ${productType}.`,
    );
  }

  const definition = await resolveMappedProgramDefinition({
    programId,
    binderProductAuthorityId: authority.id,
  });
  return resolveClaimsContractFromProgram({
    productType,
    programmeQuestionnaire: definition.questionnaire,
  });
}
