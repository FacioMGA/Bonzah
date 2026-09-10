/**
 * Mute the pg-connection-string deprecation notice about SSL mode aliases.
 *
 * pg-connection-string@2.x emits a `SECURITY WARNING` whenever DATABASE_URL
 * contains `sslmode=prefer|require|verify-ca`, telling us that pg v9 will
 * change the semantics. We are intentionally still on pg@8.x / 2.x here
 * (see `package.json`), where the runtime behaviour is unchanged — the
 * warning is pure noise in deploy logs and has been making AKS deploys
 * appear to fail when the real failure is something else further down.
 *
 * Two important details:
 *   1. `process.on('warning', ...)` does NOT suppress Node's built-in
 *      stderr printer (the printer is in C++ and runs independently of
 *      JS listeners), so we wrap `process.emitWarning` itself.
 *   2. `pg-connection-string` captures a reference to `emitWarning` at
 *      module-load time (`const { emitWarning } = require('node:process')`),
 *      so we MUST patch before `pg` is imported. This module patches at
 *      top-level on import; importing it before any `pg` import is
 *      required for the filter to take effect.
 *
 * When we upgrade to pg v9 we MUST revisit this together with every
 * DATABASE_URL builder (see `docs/architecture/contracts/security.md`)
 * so the SSL posture is explicit; remove this filter at that point.
 */

const original = process.emitWarning.bind(process);
process.emitWarning = function patchedEmitWarning(warning, ...rest) {
  const msg = typeof warning === 'string'
    ? warning
    : (warning && typeof warning === 'object' && typeof warning.message === 'string' ? warning.message : '');
  if (msg.includes("SSL modes 'prefer', 'require', and 'verify-ca'")) return;
  return original(warning, ...rest);
};
