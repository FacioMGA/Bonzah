import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import {
  ProgramDefinitionConfigurationError,
  resolveMappedProgrammeChannelPermissions,
} from './activeProgramDefinition.js';
import type { ProgrammeChannelPermissions } from './programRuntimeDefinitions.js';

/**
 * Resolves a persisted policy's public-journey permissions through its exact
 * binder-product authority and published programme definition. A policy with
 * incomplete authority context is a configuration error, never a candidate
 * for product-level or previous-version channel defaults.
 */
export async function resolvePolicyProgrammeChannelPermissions(args: {
  programId?: string | null;
  binderId?: string | null;
  productType?: string | null;
}): Promise<{ binderProductAuthorityId: string; permissions: ProgrammeChannelPermissions }> {
  const programId = String(args.programId || '').trim();
  const binderId = String(args.binderId || '').trim();
  const productCode = String(args.productType || '').trim().toUpperCase();
  if (!programId || !binderId || !productCode) {
    throw new ProgramDefinitionConfigurationError(
      '(missing)',
      'policy program, binder and product are all required for channel permissions',
    );
  }
  const authority = await tenantScopedPrisma.binderProductAuthority.findUnique({
    where: { binderId_productCode: { binderId, productCode } },
    select: { id: true },
  });
  if (!authority) {
    throw new ProgramDefinitionConfigurationError(
      `${binderId}:${productCode}`,
      'policy binder has no product authority',
    );
  }
  return {
    binderProductAuthorityId: authority.id,
    permissions: await resolveMappedProgrammeChannelPermissions({
      programId,
      binderProductAuthorityId: authority.id,
    }),
  };
}
