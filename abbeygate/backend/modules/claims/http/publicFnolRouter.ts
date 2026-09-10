import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import { claimsHttpDeps } from '../app/httpConductorDeps.js';

const router = Router();

type FnolTokenPayload = {
  purpose?: string;
  claimId?: string;
  policyId?: string;
  exp?: number;
};

const SubmitPublicFnolSchema = z.object({
  form: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value || {}).length > 0, 'FNOL form is required'),
});

function verifyFnolToken(tokenRaw: unknown): { claimId: string; policyId?: string; exp?: number } {
  const token = String(tokenRaw || '').trim();
  if (!token) throw new Error('Missing FNOL token');
  const jwtSecret = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';
  const decoded = jwt.verify(token, jwtSecret) as FnolTokenPayload;
  if (String(decoded?.purpose || '').toUpperCase() !== 'PUBLIC_FNOL') {
    throw new Error('Invalid FNOL token purpose');
  }
  const claimId = String(decoded?.claimId || '').trim();
  if (!claimId) throw new Error('Invalid FNOL token claim');
  const policyId = String(decoded?.policyId || '').trim() || undefined;
  return { claimId, policyId, exp: typeof decoded?.exp === 'number' ? decoded.exp : undefined };
}

router.get('/:token/context', async (req, res) => {
  try {
    const { claimId, policyId, exp } = verifyFnolToken(req.params.token);
    const claim = await tenantScopedPrisma.claim.findUnique({
      where: { id: claimId },
      include: {
        policy: {
          include: {
            policyHolder: true,
            program: true,
          },
        },
      },
    });
    if (!claim || !claim.policyId || (policyId && claim.policyId !== policyId)) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'FNOL link is invalid or no longer available' } });
    }

    const contract = claimsHttpDeps.resolveClaimsContractFromProgram({
      productType: claim.policy?.productType,
      programMetadata: claim.policy?.program?.metadata,
    });

    return res.json({
      success: true,
      data: {
        claimId: claim.id,
        claimNumber: claim.claimNumber,
        policyId: claim.policyId,
        policyNumber: claim.policy?.policyNumber || null,
        policyHolderName: claim.policy?.policyHolder?.name || '',
        policyHolderContact: claim.policy?.policyHolder?.contact || '',
        quoteData: claim.policy?.quoteData || {},
        driverInfo: claim.policy?.driverInfo || {},
        vehicleInfo: claim.policy?.vehicleInfo || {},
        expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
        contract,
      },
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_OR_EXPIRED_TOKEN',
        message: error instanceof Error ? error.message : 'Invalid or expired FNOL link',
      },
    });
  }
});

router.post('/:token/submit', async (req, res) => {
  try {
    const { claimId, policyId } = verifyFnolToken(req.params.token);
    const parsed = SubmitPublicFnolSchema.parse(req.body || {});
    const claim = await tenantScopedPrisma.claim.findUnique({
      where: { id: claimId },
      select: { id: true, policyId: true, status: true },
    });
    if (!claim || !claim.policyId || (policyId && claim.policyId !== policyId)) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'FNOL link is invalid or no longer available' } });
    }

    await claimsHttpDeps.executeClaimWorksheetCommand({
      claimId: claim.id,
      type: 'SUBMIT_FNOL',
      payload: {
        fnol: claimsHttpDeps.normalizeCanonicalIntake(parsed.form),
      },
      input: {
        actorType: 'CUSTOMER',
        actorId: 'public-fnol',
        actorName: 'Public FNOL Portal',
      },
    });

    return res.json({ success: true, data: { claimId: claim.id, submitted: true } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_BODY', message: error.issues[0]?.message || 'Invalid request body' } });
    }
    return res.status(400).json({
      success: false,
      error: {
        code: 'FNOL_SUBMIT_FAILED',
        message: error instanceof Error ? error.message : 'Failed to submit FNOL',
      },
    });
  }
});

export default router;
