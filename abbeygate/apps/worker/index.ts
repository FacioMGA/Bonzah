// Worker app entrypoint wrapper.
// Sentry instrument must load before backend/worker.js evaluates its
// imports — see backend/platform/observability/instrument.ts.
import '../../backend/platform/observability/instrument.js';
import '../../backend/worker.js';
