/**
 * Per-request AsyncLocalStorage context for the operating tenant.
 *
 * The resolveOperatingTenant middleware calls runWithOperatingTenant() to bind
 * the correct TenantConfig for the duration of every request. Downstream code
 * retrieves it via getTenantConfig() — which is ALS-only as of ADR-0019 and
 * throws `TenantNotResolvedError` if called outside an ALS context. CLI /
 * worker / system-outbox code must build an explicit TenantConfig (see
 * `tenantConfigForCli.ts → buildTenantConfigFromEnv()`) and wrap its
 * entrypoint with `runWithOperatingTenant(...)`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantConfig } from './tenantConfig.js';

export type TenantStore = { config: TenantConfig };

const als = new AsyncLocalStorage<TenantStore>();

export type OperatingTenantErrorStamp = { slug: string; countryCode: string };

/**
 * Side table mapping an error object to the operating tenant that was active
 * when it was thrown. Keyed by the error instance in a WeakMap, so the
 * attribution lives OFF the error's own shape: nothing is mutated (works on
 * frozen/sealed errors), entries are garbage-collected with the error, and no
 * type-laundering cast is needed to read arbitrary keys back.
 *
 * It lets background/worker capture (`captureBackgroundException`) recover the
 * tenant even though the BullMQ `on('failed')` listener fires AFTER the ALS
 * scope has already exited (so `getOperatingTenantConfig()` reads `null`
 * there). The lookup is same-process only — exactly the window in which a
 * failed job's error is handed to the failure listener.
 */
const operatingTenantByError = new WeakMap<object, OperatingTenantErrorStamp>();

function stampErrorWithOperatingTenant(err: unknown, config: TenantConfig): void {
  if (typeof err !== 'object' || err === null) return;
  // Keep the innermost (most specific) tenant: it stamps first as it unwinds.
  if (operatingTenantByError.has(err)) return;
  operatingTenantByError.set(err, { slug: config.tenantSlug, countryCode: config.countryCode });
}

/**
 * Recover the operating tenant stamped onto an error by
 * `runWithOperatingTenant`, or `null` if the error never crossed a tenant
 * scope (e.g. infra errors like a Redis connection drop).
 */
export function readOperatingTenantFromError(err: unknown): OperatingTenantErrorStamp | null {
  if (typeof err !== 'object' || err === null) return null;
  return operatingTenantByError.get(err) ?? null;
}

/**
 * Run `fn` inside an ALS context where the operating tenant is `config`.
 * The context is automatically cleaned up when the returned Promise settles.
 *
 * As `fn` throws or its promise rejects, the operating tenant is recorded
 * against the error (innermost-wins) so downstream background capture can
 * attribute the error to the correct tenant after the ALS scope is gone. This
 * is purely additive observability metadata — the same error propagates
 * unchanged, and the promise the caller awaits is untouched.
 */
export function runWithOperatingTenant<T>(config: TenantConfig, fn: () => T): T {
  return als.run({ config }, () => {
    let result: T;
    try {
      result = fn();
    } catch (err) {
      stampErrorWithOperatingTenant(err, config);
      throw err;
    }
    if (result instanceof Promise) {
      // Record the tenant on async rejection without altering the promise the
      // caller awaits. Registered synchronously here, so this microtask runs
      // before any later `on('failed')` capture reads the tenant back.
      void result.catch((err: unknown) => {
        stampErrorWithOperatingTenant(err, config);
      });
    }
    return result;
  });
}

/**
 * Return the per-request TenantConfig if we are inside a
 * runWithOperatingTenant() context, or null if we are not.
 */
export function getOperatingTenantConfig(): TenantConfig | null {
  return als.getStore()?.config ?? null;
}

/**
 * **Test-only.** Install a default operating-tenant ALS context for the
 * current async stack so unit tests that exercise pure pricing /
 * document / projection code without explicit tenancy plumbing can call
 * `getTenantConfig()` without each test wrapping its calls in
 * `runWithOperatingTenant`.
 *
 * Called once from the vitest setup file. Production code MUST NEVER
 * call this — the ALS context for live HTTP/worker code belongs to
 * `resolveOperatingTenant` and the `runWith*OperatingTenant` helpers
 * in `tenantJobContext.ts`. Tests that need to assert the fail-closed
 * behaviour clear the context for that test via
 * `withoutOperatingTenantForTest`.
 */
export function enterOperatingTenantForTest(config: TenantConfig): void {
  als.enterWith({ config });
}

/**
 * **Test-only.** Run `fn` with the ALS context cleared so a test can
 * assert that `getTenantConfig()` throws / Prisma extension blocks
 * tenant-scoped reads when no tenant is resolved (ADR-0019).
 */
export function withoutOperatingTenantForTest<T>(fn: () => T): T {
  return als.exit(fn);
}
