import { createPublicDocumentsRouter } from '../../modules/documents/http/publicDocumentsRouter.js';
import { auditLog } from '../middleware/audit.js';
import { authenticate } from '../../platform/http/middleware/auth.js';

export default createPublicDocumentsRouter({ auditLog, authenticate });

