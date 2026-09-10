import { createPublicVehiclesRouter } from '../../modules/policy/http/publicVehiclesRouter.js';
import { authenticate, requireBO } from '../../platform/http/middleware/auth.js';

export default createPublicVehiclesRouter({ authenticate, requireBO });

