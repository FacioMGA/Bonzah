import type { NextFunction } from 'express';

import { tenantScopedPrisma } from '../../../platform/db/connection.js';
import type { BoundaryRequest, BoundaryResponse } from '../../../platform/http/typedHandler.js';
import { logger } from '../../../platform/utils/logger.js';
import { isClientPortalDocument } from '../app/publicDocumentVisibility.js';
import { assertPolicyJourneyAction } from '../../insuranceConfiguration/app/journeyCapabilities.js';
import { assertConfiguredJourneyCapability, InsuranceConfigurationError } from '../../insuranceConfiguration/domain/runtimeConfiguration.js';
import { ProgramDefinitionConfigurationError } from '../../programs/domain/programDefinition.js';
import {
  resolveCustomerPolicyAccess,
  type PolicyAccessActor,
} from '../../policy/app/customerPolicyAccess.js';

/**
 * The document binary router is shared by BO and the client surface. A
 * customer may only fetch a binary belonging to a policy that the canonical
 * customer-policy access rule authorises. Staff access remains governed by
 * the route-level BO guards and document permissions.
 */
export async function requireCustomerOwnedDocument(
  req: BoundaryRequest,
  res: BoundaryResponse,
  next: NextFunction,
): Promise<void> {
  const role = String(req.user?.role || '').toUpperCase();
  if (role !== 'CUSTOMER') return next();

  const filename = String(req.params?.filename || '').trim();
  if (!filename || filename.includes('..') || filename.includes('/')) {
    return void res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid filename' },
    });
  }

  try {
    const scopedAccountId = String(req.tenantId || '').trim();
    const actor = (req.user && scopedAccountId
      ? { ...req.user, primaryAccountId: scopedAccountId }
      : req.user) as PolicyAccessActor;

    const document = await tenantScopedPrisma.document.findFirst({
      where: {
        storageUri: `/api/documents/${filename}`,
        status: 'GENERATED',
      },
      select: { policyId: true, docPack: true, type: true },
    });
    if (!document || !isClientPortalDocument(document)) {
      return void res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Document not found' },
      });
    }
    const policyId = String(document?.policyId || '').trim();
    if (!policyId) {
      return void res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Document not found' },
      });
    }

    const access = await resolveCustomerPolicyAccess(actor, policyId);
    if (access === 'missing') {
      return void res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Document not found' },
      });
    }
    if (access !== 'ok') {
      return void res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
    }

    const policy = await tenantScopedPrisma.policy.findUnique({
      where: { id: policyId },
      select: { programId: true, binderId: true, productType: true },
    });
    if (!policy) return void res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    const definition = await assertPolicyJourneyAction(policy, 'customer', 'documents');
    // This is the authenticated customer portal route. Check its prerequisite
    // against the same resolved immutable definition, without a second lookup.
    assertConfiguredJourneyCapability(definition.workflow, 'customer', 'portal');

    return next();
  } catch (error) {
    if (error instanceof InsuranceConfigurationError) {
      return void res.status(403).json({ success: false, error: { code: error.code, message: error.message } });
    }
    if (error instanceof ProgramDefinitionConfigurationError) {
      return void res.status(503).json({ success: false, error: { code: error.code, message: error.message } });
    }
    logger.error({ err: error, filename, userId: req.user?.id }, '[Documents] Customer document access check failed');
    return void res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to authorize document access' },
    });
  }
}
