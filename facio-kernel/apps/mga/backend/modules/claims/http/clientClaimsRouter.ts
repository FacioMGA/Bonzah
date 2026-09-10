import { Router } from 'express';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import {
  customerCanAccessPolicy,
  listCustomerOwnedPolicyIds,
  type PolicyAccessActor,
} from '../../policy/app/customerPolicyAccess.js';
import { claimsHttpDeps } from '../app/httpConductorDeps.js';
import { executeWorksheetCommand } from '../app/commands/executeWorksheetCommand.js';
import { getClaimWorksheetView } from '../app/queries/getClaimWorksheetView.js';
import { listClaimsPage } from '../app/queries/listClaimsPage.js';
import { assertPolicyJourneyAction } from '../../insuranceConfiguration/app/journeyCapabilities.js';
import { InsuranceConfigurationError } from '../../insuranceConfiguration/domain/runtimeConfiguration.js';
import { ProgramDefinitionConfigurationError } from '../../programs/domain/programDefinition.js';

const router = Router();

const FnolSubmitSchema = z.object({
  form: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value || {}).length > 0, 'FNOL form is required'),
});

type ClientActor = PolicyAccessActor & { id?: string; name?: string };

async function requireOwnedClaim(actor: ClientActor, claimId: string): Promise<{ id: string; policyId: string } | null> {
  const claim = await tenantScopedPrisma.claim.findUnique({
    where: { id: claimId },
    select: { id: true, policyId: true },
  });
  if (!claim?.policyId) return null;
  const owns = await customerCanAccessPolicy(actor, claim.policyId);
  return owns ? { id: claim.id, policyId: claim.policyId } : null;
}

router.get('/', async (req, res) => {
  try {
    const actor = (req.user || {}) as ClientActor;
    const requestedPolicyId = String(req.query.policyId || '').trim();
    if (requestedPolicyId) {
      const owns = await customerCanAccessPolicy(actor, requestedPolicyId);
      if (!owns) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
      }
    }
    const ownedPolicyIds = requestedPolicyId ? [requestedPolicyId] : await listCustomerOwnedPolicyIds(actor);
    if (ownedPolicyIds.length === 0) {
      return res.json({ success: true, data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } });
    }
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 100)));
    const result = await listClaimsPage({
      page,
      pageSize,
      policyId: requestedPolicyId || undefined,
      policyIds: requestedPolicyId ? undefined : ownedPolicyIds,
      status: String(req.query.status || '').trim() || undefined,
      statusIn: String(req.query.statusIn || '').trim() || undefined,
    });
    return res.json({
      success: true,
      data: result.items,
      pagination: { page, pageSize, total: result.total, totalPages: result.totalPages },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'CLAIMS_LIST_FAILED', message: error instanceof Error ? error.message : 'Failed to list claims' },
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const actor = (req.user || {}) as ClientActor;
    const owned = await requireOwnedClaim(actor, String(req.params.id));
    if (!owned) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Claim not found' } });
    }
    const worksheet = await getClaimWorksheetView(owned.id);
    return res.json({ success: true, data: worksheet });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'WORKSHEET_FETCH_FAILED', message: error instanceof Error ? error.message : 'Failed to fetch claim' },
    });
  }
});

router.post('/:id/fnol/submit', async (req, res) => {
  try {
    const actor = (req.user || {}) as ClientActor;
    const owned = await requireOwnedClaim(actor, String(req.params.id));
    if (!owned) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Claim not found' } });
    }
    const parsed = FnolSubmitSchema.parse(req.body || {});
    const policy = await tenantScopedPrisma.policy.findUnique({
      where: { id: owned.policyId },
      select: { programId: true, binderId: true, productType: true },
    });
    if (!policy) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Claim not found' } });
    // A customer's claim capability includes the published portal prerequisite.
    // Ownership is checked first; neither body fields nor customer role grant it.
    await assertPolicyJourneyAction(policy, 'customer', 'claim');
    await executeWorksheetCommand({
      claimId: owned.id,
      type: 'SUBMIT_FNOL',
      payload: { fnol: claimsHttpDeps.normalizeCanonicalIntake(parsed.form) },
      actor: {
        actorType: 'CUSTOMER',
        actorId: String(actor.id || 'customer'),
        actorName: String(actor.name || actor.email || 'Customer'),
      },
    });
    return res.json({ success: true, data: { ok: true } });
  } catch (error) {
    if (error instanceof InsuranceConfigurationError) {
      return res.status(403).json({ success: false, error: { code: error.code, message: error.message } });
    }
    if (error instanceof ProgramDefinitionConfigurationError) {
      return res.status(503).json({ success: false, error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_BODY', message: error.issues[0]?.message || 'Invalid request body' } });
    }
    return res.status(400).json({
      success: false,
      error: { code: 'FNOL_SUBMIT_FAILED', message: error instanceof Error ? error.message : 'Failed to submit FNOL' },
    });
  }
});

export default router;
