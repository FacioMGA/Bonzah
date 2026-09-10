import { assertPolicyJourneyAction, isConfiguredAgentIdentity } from '../../insuranceConfiguration/app/journeyCapabilities.js';
import { readInsuranceConfiguration, InsuranceConfigurationError, type JourneyActor } from '../../insuranceConfiguration/domain/runtimeConfiguration.js';
/**
 * Programme-definition channel gate (ADR-0101).
 *
 * Enforces the exact programme definition's public-journey permissions at the
 * public HTTP chokepoints. A logged-in Back Office user bypasses an OFF
 * switch; customers are refused with 403. Requires `optionalAuthenticate` to
 * have run first so `req.user` is populated.
 */
import type { Request, Response } from 'express';
import { isBackOfficeRequest } from '../../../platform/http/middleware/auth.js';
import { resolveProductAvailability } from '../../jurisdiction/app/productAvailability.js';
import { ProgramDefinitionConfigurationError } from '../../programs/app/activeProgramDefinition.js';
import { resolvePolicyProgrammeChannelPermissions } from '../../programs/app/policyProgrammeChannelPermissions.js';
import type { ProgrammeChannelPermissions } from '../../programs/app/programRuntimeDefinitions.js';

/** Actor is derived only from authenticated server identity, never body/query fields. */
export function requestJourneyActor(req: Request): JourneyActor {
  if (req.user && isConfiguredAgentIdentity({ role: req.user.role, userType: typeof req.user['userType'] === 'string' ? req.user['userType'] : null })) return 'agent';
  return isBackOfficeRequest(req) ? 'operator' : 'customer';
}

export type ProductChannelGate = keyof ProgrammeChannelPermissions;

function disabledMessage(gate: ProductChannelGate): string {
  if (gate === 'payment') {
    return 'Online payment is not available for this product. An advisor will contact you to complete your purchase.';
  }
  if (gate === 'quote') {
    return 'Online quoting is not available for this product right now. Please request a callback.';
  }
  return 'Online applications are not available for this product right now. Please request a callback.';
}
/**
 * Returns true when the request may proceed (gate ON, or a BO user bypassing).
 * On refusal it writes the 403 response and returns false.
 */
export async function enforcePolicyProgrammeChannelGate(
  req: Request,
  res: Response,
  policy: { programId?: string | null; binderId?: string | null; productType?: string | null },
  gate: ProductChannelGate,
): Promise<boolean> {
  const productCode = String(policy.productType || '').trim().toUpperCase();
  // ADR-0100: BO may bypass an online switch, never missing product authority.
  const availability = resolveProductAvailability(productCode);
  if (!availability.available) {
    res.status(403).json({ success: false, error: { code: 'PRODUCT_UNAVAILABLE', message: availability.message } });
    return false;
  }
  try {
    const actor = requestJourneyActor(req);
    const definition = await assertPolicyJourneyAction(policy, actor, gate);
    if (actor === 'operator' || (actor === 'agent' && readInsuranceConfiguration(definition.workflow))) return true;
  } catch (error) {
    if (!(error instanceof InsuranceConfigurationError) && !(error instanceof ProgramDefinitionConfigurationError)) throw error;
    res.status(403).json({ success: false, error: { code: 'PRODUCT_CHANNEL_DISABLED', message: error.message } });
    return false;
  }
  const programId = String(policy.programId || '').trim();
  let resolved;
  try {
    resolved = await resolvePolicyProgrammeChannelPermissions(policy);
  } catch (error) {
    if (!(error instanceof ProgramDefinitionConfigurationError)) throw error;
    res.status(503).json({ success: false, error: { code: error.code, message: error.message } });
    return false;
  }
  if (resolved.permissions[gate]) return true;
  res.status(403).json({
    success: false,
    error: {
      code: 'PRODUCT_CHANNEL_DISABLED',
      message: disabledMessage(gate),
      details: { productCode, programId, binderProductAuthorityId: resolved.binderProductAuthorityId, gate },
    },
  });
  return false;
}
