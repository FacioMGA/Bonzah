
import { createMbeRouter } from '../../modules/mbe/http/mbeRouter.js';
import { auditLog } from '../middleware/audit.js';

export default createMbeRouter({ auditLog });
