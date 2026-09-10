import { readPolicyJourneyCapabilities } from '../app/journeyCapabilities.js';
import { Router } from 'express';
import { z } from 'zod';
import { getTenantConfig } from '../../../platform/tenant/tenantConfig.js';
import { requirePermission } from '../../accessControl/http/permissionMiddleware.js';
import { readInsuranceConfiguration, saveInsuranceConfiguration, publishInsuranceConfiguration, insuranceConfigurationEditorSchema } from '../app/configurationService.js';
import { InsuranceConfigurationError } from '../domain/runtimeConfiguration.js';
import { McpToolError } from '../../mcp/domain/toolError.js';

export const insuranceConfigurationRouter = Router();
// Mounted only below the authenticated, membership-resolved operating-tenant boundary.
insuranceConfigurationRouter.get('/policies/:policyId/journey', requirePermission('policies', 'view'), async (req, res, next) => {
  try { res.json({ success: true, data: await readPolicyJourneyCapabilities(String(req.params.policyId)) }); } catch (error) { next(error); }
});
insuranceConfigurationRouter.get('/schema', requirePermission('configuration', 'read'), (req, res, next) => {
  try { res.json({ success: true, data: insuranceConfigurationEditorSchema({ tenantId: getTenantConfig().id, userId: req.user?.id ?? '', permissions: ['configuration.read'] }) }); } catch (error) { next(error); }
});
insuranceConfigurationRouter.get('/programs/:programId', requirePermission('configuration', 'read'), async (req, res, next) => {
  try { res.json({ success: true, data: await readInsuranceConfiguration({ programId: req.params.programId }, { tenantId: getTenantConfig().id, userId: req.user?.id ?? '', permissions: ['configuration.read'] }) }); } catch (error) { next(error); }
});
insuranceConfigurationRouter.put('/programs/:programId', requirePermission('configuration', 'draft'), async (req, res, next) => {
  try {
    // Path is authoritative. A conflicting model-supplied target is rejected rather than overwritten.
    if (req.body?.programId !== undefined) throw new InsuranceConfigurationError('programmeId belongs in the URL, not the request body.');
    res.json({ success: true, data: await saveInsuranceConfiguration({ ...req.body, programId: req.params.programId }, { tenantId: getTenantConfig().id, userId: req.user?.id ?? '', permissions: ['configuration.draft'] }) });
  } catch (error) { next(error); }
});
insuranceConfigurationRouter.post('/programs/:programId/publish', requirePermission('configuration', 'publish_sandbox'), async (req, res, next) => {
  try {
    if (req.body?.programId !== undefined) throw new InsuranceConfigurationError('programId belongs in the URL, not the request body.');
    res.json({ success: true, data: await publishInsuranceConfiguration({ ...req.body, programId: req.params.programId }, { tenantId: getTenantConfig().id, userId: req.user?.id ?? '', permissions: ['configuration.publish_sandbox'] }) });
  } catch (error) { next(error); }
});
insuranceConfigurationRouter.use((error: unknown, _req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
  if (error instanceof z.ZodError) { res.status(422).json({ success: false, error: { code: 'INVALID_CONFIGURATION', message: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' ') } }); return; }
  if (error instanceof InsuranceConfigurationError || error instanceof McpToolError) { res.status(error.message.startsWith('STALE_DEFINITION') ? 409 : error instanceof McpToolError && error.code === 'DRAFT_NOT_FOUND' ? 404 : error instanceof McpToolError && error.code === 'UNAUTHORIZED' ? 403 : 422).json({ success: false, error: { code: error.code, message: error.message } }); return; }
  next(error);
});
