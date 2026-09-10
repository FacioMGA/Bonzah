import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { parsePublishedProgramMbeProductConfig, type ProgramMbeProductConfigV1 } from '../../mbe/domain/programProduct.js';
import { resolveMappedProgramDefinition } from '../../programs/app/activeProgramDefinition.js';

/**
 * Resolves policy coverage from the same immutable, binder-authorised programme
 * definition as quote and issuance. Coverage is never reconstructed from
 * Program.metadata or initialised on first read.
 */
export async function resolveProgrammeCoverageConfiguration(args: {
  programId: string;
  binderId: string;
  productType: string;
}): Promise<ProgramMbeProductConfigV1> {
  const programId = String(args.programId || '').trim();
  const binderId = String(args.binderId || '').trim();
  const productCode = String(args.productType || '').trim().toUpperCase();
  if (!programId || !binderId || !productCode) {
    throw new Error('Coverage selection requires a policy programme, binder and product type.');
  }

  const authority = await tenantScopedPrisma.binderProductAuthority.findUnique({
    where: { binderId_productCode: { binderId, productCode } },
    select: { id: true },
  });
  if (!authority) {
    throw new Error(`No active binder product authority is configured for ${productCode}.`);
  }

  const definition = await resolveMappedProgramDefinition({
    programId,
    binderProductAuthorityId: authority.id,
  });
  if (definition.pricingMode !== 'AUTOMATED') {
    throw new Error('Coverage selection requires an automated programme definition.');
  }
  return parsePublishedProgramMbeProductConfig(definition.coverage, { productType: productCode });
}
