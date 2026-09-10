// Sentry must run its `Sentry.init()` before any auto-instrumented
// module is loaded (express, prisma, applicationinsights, …). Importing
// the instrument first guarantees ESM evaluates it before
// `backend/index.js` begins evaluating its imports. See
// `backend/platform/observability/instrument.ts`.
import '../../backend/platform/observability/instrument.js';
import { startApiServerProcess } from '../../backend/index.js';

void startApiServerProcess();
