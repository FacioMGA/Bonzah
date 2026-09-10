/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, '..'),
  test: {
    globals: true,
    environment: 'node',
    include: [
      // Server tests
      'backend/**/__tests__/**/*.test.ts',
      'backend/**/*.test.ts',
      'backend/test/**/*.test.ts',
      // Frontend tests
      'frontend/src/**/*.{test,spec}.{ts,tsx}',
      'frontend/src/**/__tests__/**/*.{test,spec}.{ts,tsx}',
      'components/**/*.{test,spec}.{ts,tsx}',
      'pages/**/*.{test,spec}.{ts,tsx}',
      // Phase 3 — workspace package tests live next to their source
      'packages/**/__tests__/**/*.{test,spec}.{ts,tsx}',
      'packages/**/*.{test,spec}.{ts,tsx}',
      // E2E journey contract tests
      'e2e/**/*.{test,spec}.{ts,tsx,js,jsx}',
      // Operator/migration tool tests (TS)
      'tools/**/__tests__/**/*.{test,spec}.{ts,mts}',
    ],
    exclude: [
      '**/node_modules/**',
      // k6 load scripts are not Vitest-compatible suites
      'e2e/load/**',
      // Playwright browser specs (tier 5 per ADR-0030) — driven by
      // @playwright/test from e2e/browser/playwright.config.ts.
      'e2e/browser/**',
    ],
    setupFiles: ['frontend/src/shared/test/setup.ts'],
    // Phase 3: specific @facio/validation subpath keys come BEFORE the
    // root key so they win exact matches; the root key would otherwise
    // prefix-match `@facio/validation/...` and rewrite incorrectly.
    alias: {
      '@facio/validation/frontend': path.resolve(__dirname, '..', 'packages/validation/src/adapters/frontend.ts'),
      '@facio/validation/backend': path.resolve(__dirname, '..', 'packages/validation/src/adapters/backend.ts'),
      '@facio/validation': path.resolve(__dirname, '..', 'packages/validation/src/index.ts'),
      '@facio/products': path.resolve(__dirname, '..', 'packages/products/src/index.ts'),
      '@': path.resolve(__dirname, '..', 'frontend'),
      '@server': path.resolve(__dirname, '..', 'backend'),
      '@web': path.resolve(__dirname, '..', 'frontend', 'src'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'frontend/src/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'pages/**/*.{ts,tsx}',
        'backend/**/*.ts',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.test.*',
        '**/*.spec.*',
        '**/__tests__/**',
        '**/dist/**',
        'backend/dist/**',
      ],
      thresholds: {
        lines: 40,
        branches: 30,
        functions: 35,
        statements: 40,
      },
    },
  },
  resolve: {
    alias: {
      '@facio/validation/frontend': path.resolve(__dirname, '..', 'packages/validation/src/adapters/frontend.ts'),
      '@facio/validation/backend': path.resolve(__dirname, '..', 'packages/validation/src/adapters/backend.ts'),
      '@facio/validation': path.resolve(__dirname, '..', 'packages/validation/src/index.ts'),
      '@facio/products': path.resolve(__dirname, '..', 'packages/products/src/index.ts'),
      '@': path.resolve(__dirname, '..', 'frontend'),
      '@server': path.resolve(__dirname, '..', 'backend'),
      '@web': path.resolve(__dirname, '..', 'frontend', 'src'),
    },
  },
});
