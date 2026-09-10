/**
 * `getPolicyListRegistry` startup contract (ADR-0019 / PR 1B).
 *
 * Pins the post-deletion behaviour: when the canonical
 * `src/products/policies/list/registry.json` file is missing, the
 * loader THROWS — there is no embedded fallback registry
 * constant to swap in. Startup validation calls this loader at boot,
 * so the failure surfaces as a pod health-check failure rather than
 * a per-request degradation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('getPolicyListRegistry — fail-closed when JSON file missing', () => {
  let originalCwd: () => string;

  beforeEach(() => {
    // Force a CWD where the registry file does not exist so the loader
    // walks every candidate path and exhausts them. We don't mutate the
    // real filesystem — `process.cwd` is monkey-patched on the global.
    originalCwd = process.cwd;
    Object.defineProperty(process, 'cwd', {
      configurable: true,
      value: () => '/nonexistent-cwd-for-policy-list-registry-test',
    });
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(process, 'cwd', {
      configurable: true,
      value: originalCwd,
    });
    vi.resetModules();
  });

  it('throws a descriptive error when no candidate file is readable', async () => {
    const mod = await import('../policyListRegistry.js');
    expect(() => mod.getPolicyListRegistry()).toThrow(/No registry file found/);
    expect(() => mod.getPolicyListRegistry()).toThrow(/Per ADR-0019/);
  });

  it('does not silently substitute an embedded fallback', async () => {
    const mod = await import('../policyListRegistry.js');
    // The loader should never return a valid object when the file is
    // missing; it must throw. If a future refactor reintroduces a
    // fallback constant, this test catches the regression because the
    // call would resolve instead of throw.
    expect(() => mod.getPolicyListRegistry()).toThrow();
  });
});
