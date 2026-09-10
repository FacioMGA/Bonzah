/**
 * Product validation profile registry.
 *
 * Mirrors the shape of `ProductRegistry` (for manifests) but scoped to
 * validation. Each product registers its profile at module-load time by
 * calling `ValidationRegistry.register(profile)`. The runner looks profiles
 * up by `productCode` (case-insensitive).
 *
 * Phase 3 change (2026-04-27): the package exports the `Registry` class,
 * not a module-level singleton. `createValidationContext` instantiates one
 * Registry per context (one for the FE adapter, one for the BE adapter)
 * so the FE and BE registrations stay isolated. The adapters expose their
 * Registry as `ValidationRegistry`; consumers import it from
 * `@facio/validation/frontend` or `@facio/validation/backend`.
 *
 * `spine/v2` Wave 5: a missing profile is a hard failure. The pre-Wave-2
 * "best-effort manifest-driven validator" fallback was deleted in Wave 2
 * — `runner.ts` now throws on missing profiles. Every product MUST
 * register at module load (`backend/products/registerProducts.ts` and
 * the corresponding FE adapter init).
 */

import type { ValidationProfile } from './types.js';

export class Registry {
  private profiles = new Map<string, ValidationProfile>();

  register(profile: ValidationProfile): void {
    // Last-writer-wins by design. We do NOT log a warn here:
    // `@facio/validation` is environment-isolated (Amendment #6 — see
    // tools/quality/check-validation-purity.mjs) and must not import
    // a logger from any environment-specific layer. If double-registration
    // ever becomes a real problem, surface it via a static-analysis CI
    // guard that scans profile loaders, not via runtime.
    this.profiles.set(profile.productCode.toUpperCase(), profile);
  }

  get(productCode: string): ValidationProfile | undefined {
    return this.profiles.get(String(productCode || '').toUpperCase());
  }

  has(productCode: string): boolean {
    return this.profiles.has(String(productCode || '').toUpperCase());
  }

  list(): ValidationProfile[] {
    return Array.from(this.profiles.values());
  }

  /** Test helper: wipe the registry. Do not call in app code. */
  _resetForTests(): void {
    this.profiles.clear();
  }
}
