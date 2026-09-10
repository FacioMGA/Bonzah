// FacioMGA - Policy API Routes

import { Router } from 'express';
import { registerPolicyReadRoutes } from '../../modules/policy/http/readRouter.js';
import { registerPolicyMutationRoutes } from '../../modules/policy/http/mutationsRouter.js';
import { registerPolicyBillingRoutes } from '../../modules/policy/http/billingRouter.js';
import { registerPolicyVersionRoutes } from '../../modules/policy/http/versionsRouter.js';
import { registerPolicyBindingRoutes } from '../../modules/policy/http/bindingRouter.js';
import { registerPolicyUwRoutes } from '../../modules/policy/http/uwRouter.js';
import { registerPolicyQuoteRoutes } from '../../modules/policy/http/quoteRouter.js';
import { registerPolicyEndorsementRoutes } from '../../modules/policy/http/endorsementsRouter.js';
import { registerPolicyStatusRoutes } from '../../modules/policy/http/statusRouter.js';
import { registerPolicyCoverageRoutes } from '../../modules/policy/http/coverageRouter.js';
import { registerPolicyQuoteHistoryRoutes } from '../../modules/policy/http/quoteHistoryRouter.js';
import { registerPolicyClaimRoutes } from '../../modules/policy/http/claimsRouter.js';
import { registerPolicyAdminRoutes } from '../../modules/policy/http/adminRouter.js';
import { registerPolicyCancellationRoutes } from '../../modules/policy/http/cancellationsRouter.js';
import { registerPolicyDetailRoutes } from '../../modules/policy/http/detailsRouter.js';
import { registerPolicyStateRoutes } from '../../modules/policy/http/stateRouter.js';
import { registerPolicyImportRoutes } from '../../modules/policy/http/importsRouter.js';
import { requirePolicyAccess } from '../middleware/policyAccess.js';

const router = Router();

// Enforce per-policy access control for UUID policy ids only (avoid matching fixed routes like /calculate-premium).
router.use('/:id([0-9a-fA-F-]{36})', requirePolicyAccess);

// Extracted route modules (keep behavior identical).
registerPolicyReadRoutes(router);
registerPolicyMutationRoutes(router);
registerPolicyBillingRoutes(router);
registerPolicyVersionRoutes(router);
registerPolicyBindingRoutes(router);
registerPolicyUwRoutes(router);
registerPolicyQuoteRoutes(router);
registerPolicyEndorsementRoutes(router);
registerPolicyStatusRoutes(router);
registerPolicyCoverageRoutes(router);
registerPolicyQuoteHistoryRoutes(router);
registerPolicyClaimRoutes(router);
registerPolicyAdminRoutes(router);
registerPolicyCancellationRoutes(router);
registerPolicyDetailRoutes(router);
registerPolicyStateRoutes(router);
registerPolicyImportRoutes(router);

export default router;
