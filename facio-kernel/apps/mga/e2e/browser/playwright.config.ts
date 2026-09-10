import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for tier 5 browser E2E (ADR-0030).
 *
 * The customer wizard happy paths run against a locally-served
 * frontend + API. CI provisions Postgres / Redis the same way
 * `tools/quality/agent-gate.sh ensure_local_services` does — see
 * docs/architecture/decisions/ADR-0030-browser-e2e-tier.md for the
 * tenancy + surfaces contract this tier honours.
 */

const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:8080';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    extraHTTPHeaders: {
      // Tier 5 specs target the public surface; the api base is exposed
      // for fixtures that need to seed sessions out-of-band.
      'x-e2e-api-base-url': API_BASE_URL,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
