import { Router } from 'express';

import accountsRouter from './accounts.js';
import accounts360Router from './accounts360.js';
import bindersRouter from '../../modules/policy/http/bindersRouter.js';
import bordereauxRouter from './bordereaux.js';
import claimsRouter from './claimsWorksheet.js';
import communicationsRouter from './communications.js';
import emailPreviewRouter from '../../modules/communications/http/emailPreviewRouter.js';
import org2vecIngestRouter from '../../modules/communications/http/org2vecIngestRouter.js';
import submissionMemoryRouter from '../../modules/policy/http/submissionMemoryRouter.js';
import documentsRouter from './documents.js';
import invoicesRouter from './invoices.js';
import jobsRouter from './jobs.js';
import mbeRouter from './mbe.js';
import policyHoldersRouter from './policyHolders.js';
import peopleRouter from '../../modules/people/http/peopleRouter.js';
import productsRouter from '../../modules/products/http/productsRouter.js';
import { createProductChannelAdminRouter } from '../../modules/policy/http/productChannelAdminRouter.js';
import programsRouter from './programs.js';
import reconciliationRouter from './reconciliation.js';
import reportsRouter from './reports.js';
import settingsRouter from './settings.js';
import templatesRouter from './templates.js';
import behaviorRouter from '../../modules/behavior/http/behaviorRouter.js';
import mcpRouter from '../../modules/mcp/http/mcpRouter.js';
import mcpKeysRouter from '../../modules/mcp/http/mcpKeysRouter.js';
import mcpActionsRouter from '../../modules/mcp/http/mcpActionsRouter.js';
import oauthClientsBoRouter from '../../modules/mcp/oauth/http/oauthClientsBoRouter.js';
import motorMarketIntegrationsRouter from '../../modules/motorMarketIntegrations/http/motorMarketIntegrationsRouter.js';
import { requireBO } from '../../platform/http/middleware/auth.js';
import { requireSurfaceAccess } from '../middleware/surfaceGate.js';
import { buildAccessControlRouter } from '../../modules/accessControl/http/accessControlRouter.js';
import { requirePermission } from '../../modules/accessControl/http/permissionMiddleware.js';
import { createUsersModuleRouter } from '../../modules/users/http/usersRouter.js';


export function createBoApiRouter() {
  const router = Router();
  router.use(requireSurfaceAccess(['bo']));

  router.use('/claims', requireBO, requirePermission('claims', 'view'), claimsRouter);
  router.use('/invoices', requireBO, requirePermission('billing', 'view'), invoicesRouter);
  router.use('/bordereaux', requireBO, requirePermission('reports', 'view'), bordereauxRouter);
  router.use('/reconciliation', requireBO, requirePermission('billing', 'reconcile'), reconciliationRouter);
  router.use('/policy-holders', requireBO, requirePermission('policies', 'view'), policyHoldersRouter);
  router.use('/people', requireBO, peopleRouter);
  router.use('/reports', requireBO, requirePermission('reports', 'view'), reportsRouter);
  router.use('/documents', requireBO, requirePermission('documents', 'view'), documentsRouter);
  router.use('/users', requireBO, createUsersModuleRouter());
  router.use('/access-control', buildAccessControlRouter());
  router.use('/settings', requireBO, requirePermission('settings', 'view'), settingsRouter);
  router.use('/motor-market-integrations', requireBO, requirePermission('settings', 'view'), motorMarketIntegrationsRouter);
  router.use('/accounts', requireBO, accountsRouter);
  router.use('/accounts360', requireBO, accounts360Router);
  router.use('/binders', requireBO, requirePermission('binders', 'view'), bindersRouter);
  router.use('/products', requireBO, productsRouter);
  // Product channel switches (ADR-0046): per-product public journey gates.
  router.use('/product-channels', requireBO, requirePermission('settings', 'view'), createProductChannelAdminRouter());
  router.use('/programs', requireBO, requirePermission('programs', 'view'), programsRouter);
  router.use('/mbe', requireBO, mbeRouter);
  router.use('/jobs', requireBO, jobsRouter);
  router.use('/communications', requireBO, communicationsRouter);
  // Email Preview & Testing Centre (email-safety Phase 4): read-only inventory,
  // fixture-driven previews, lint + coverage, and an audited synthetic test-send
  // to allowlisted mailboxes only. Never creates production policies/payments.
  router.use('/email-preview', requireBO, emailPreviewRouter);
  // Org2Vec demo email ingestion (ADR-0044): sample / upload / live Graph.
  router.use('/org2vec/ingest', requireBO, org2vecIngestRouter);
  // Org2Vec submission (underwriting) memory + ask (ADR-0044).
  router.use('/policies', requireBO, submissionMemoryRouter);
  router.use('/templates', requireBO, templatesRouter);
  // Behavior Console. Strictly additive — exposes projections built
  // from the existing outbox, never mutates upstream domain state.
  router.use('/behavior', requireBO, behaviorRouter);

  // Config MCP V1 (ADR-0036). HTTP/SSE transport for the AI Product
  // Architect agent. Individual tool calls carry their own
  // `configuration.*` permission requirement (enforced by
  // `authorizeToolCall`) — the router-level guard is just BO surface
  // gating + JWT presence.
  router.use('/mcp/config', requireBO, mcpRouter);

  // Config MCP key management (ADR-0036 amendment). Issue / list /
  // revoke remote-agent API keys for Claude / ChatGPT / Cursor MCP
  // clients. Each route inside the sub-router carries its own
  // configuration.* requirePermission gate.
  router.use('/mcp/keys', requireBO, mcpKeysRouter);
  router.use('/mcp/actions', requireBO, mcpActionsRouter);
  router.use('/mcp/oauth-clients', requireBO, oauthClientsBoRouter);

  return router;
}
