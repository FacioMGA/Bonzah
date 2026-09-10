import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { sentryVitePlugin } from '@sentry/vite-plugin';

function zodCspJitlessPlugin() {
  return {
    name: 'facio-zod-csp-jitless',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.includes('/zod/')) return null;
      const transformed = code
        .replace('globalConfig = {};', 'globalConfig = { jitless: true };')
        .replace('__zod_globalConfig = {})', '__zod_globalConfig = { jitless: true })');
      return transformed === code ? null : transformed;
    },
  };
}

export default defineConfig(({ mode }: { mode: string }) => {
    let env: Record<string, string> = {};
    try {
        env = loadEnv(mode, '.', '');
    } catch (e) {
        // Ignore .env file errors in sandbox
        console.warn('Could not load .env file, using defaults');
    }
    const analyze = (process.env.ANALYZE || '').toLowerCase() === 'true';
    const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN;
    const sentryOrg = process.env.SENTRY_ORG || env.SENTRY_ORG;
    const sentryProject = process.env.SENTRY_PROJECT || env.SENTRY_PROJECT;
    const shouldUploadSentrySourceMaps = Boolean(sentryAuthToken && sentryOrg && sentryProject);
    const surfaceTarget = String(process.env.FACIO_SURFACE_BUILD || '').trim().toLowerCase();
    const isSurfaceBuild = surfaceTarget === 'public' || surfaceTarget === 'client' || surfaceTarget === 'bo';
    const surfaceHtmlInputPath = isSurfaceBuild
      ? path.resolve(__dirname, `public/index.${surfaceTarget}.html`)
      : undefined;
    const surfaceHtmlInput = surfaceHtmlInputPath ? { index: surfaceHtmlInputPath } : undefined;
    const surfaceAssetsDir = isSurfaceBuild ? `assets-${surfaceTarget}` : 'assets';
    const surfaceOutDir = isSurfaceBuild ? `dist/${surfaceTarget}` : 'dist';
    const surfaceBaseByTarget: Record<string, string> = {
      public: '/public/',
      client: '/client/',
      bo: '/bo/',
    };
    const surfaceBase = isSurfaceBuild ? (surfaceBaseByTarget[surfaceTarget] || '/') : '/';
    const surfaceDefine = isSurfaceBuild ? JSON.stringify(surfaceTarget) : undefined;

    return {
      root: __dirname,
      // Keep root-level .env as the single source for local runtime configuration.
      envDir: path.resolve(__dirname, '..'),
      base: surfaceBase,
      define: {
        ...(surfaceDefine ? { __FACIO_SURFACE__: surfaceDefine } : {}),
        ...(surfaceDefine ? { 'import.meta.env.VITE_SURFACE': surfaceDefine } : {}),
      },
      server: {
        port: 5173,
        host: '0.0.0.0',
        proxy: {
          '/api': {
            target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
            changeOrigin: true,
          },
        },
      },
      plugins: [
        zodCspJitlessPlugin(),
        react(),
        ...(analyze
          ? [
              visualizer({
                filename: 'dist/bundle-stats.html',
                template: 'treemap',
                gzipSize: true,
                brotliSize: true,
                open: false,
              }),
            ]
          : []),
        ...(shouldUploadSentrySourceMaps
          ? [
              sentryVitePlugin({
                org: sentryOrg,
                project: sentryProject,
                authToken: sentryAuthToken,
                release: {
                  name: process.env.SENTRY_RELEASE || env.SENTRY_RELEASE,
                },
              }),
            ]
          : []),
      ],
      resolve: {
        // Phase 3: route `@facio/validation` and its subpath exports at
        // package source. Specific subpath keys come BEFORE the root key
        // so they win exact matches; the root key would otherwise
        // prefix-match `@facio/validation/...` and rewrite to
        // `index.ts/...` which is wrong. (See @rollup/plugin-alias docs.)
        alias: [
          { find: '@facio/validation/frontend', replacement: path.resolve(__dirname, '../packages/validation/src/adapters/frontend.ts') },
          { find: '@facio/validation/backend', replacement: path.resolve(__dirname, '../packages/validation/src/adapters/backend.ts') },
          { find: '@facio/validation', replacement: path.resolve(__dirname, '../packages/validation/src/index.ts') },
          { find: '@facio/products', replacement: path.resolve(__dirname, '../packages/products/src/index.ts') },
          { find: '@', replacement: path.resolve(__dirname, '.') },
          { find: '@app', replacement: path.resolve(__dirname, './src/surfaces/app') },
          { find: '@bo', replacement: path.resolve(__dirname, './src/surfaces/bo') },
          { find: '@client', replacement: path.resolve(__dirname, './src/surfaces/client') },
          { find: '@public', replacement: path.resolve(__dirname, './src/surfaces/public') },
          { find: '@surfaces', replacement: path.resolve(__dirname, './src/surfaces') },
          { find: '@modules', replacement: path.resolve(__dirname, './src/modules') },
          { find: '@products', replacement: path.resolve(__dirname, './src/products') },
          { find: '@shared', replacement: path.resolve(__dirname, './src/shared') },
        ],
      },
      build: {
        sourcemap: shouldUploadSentrySourceMaps ? 'hidden' : false,
        outDir: surfaceOutDir,
        assetsDir: surfaceAssetsDir,
        emptyOutDir: true,
        chunkSizeWarningLimit: 700,
        rollupOptions: {
          ...(surfaceHtmlInput ? { input: surfaceHtmlInput } : {}),
          output: {
            manualChunks(id: string) {
              // Keep BO claims flows together. Desk imports intake drawers, and forcing
              // separate desk/intake/manual shared chunks creates circular chunk edges.
              if (surfaceTarget === 'bo' && id.includes('/src/products/claims/')) return 'bo-claims-workspace';

              // Keep shared UI internals together to avoid circular chunk order issues
              // caused by barrel re-exports (e.g. IconButton through shared/ui index).
              if (id.includes('/src/shared/ui/')) return 'shared-ui';
              // Keep record-list internals isolated outside the BO claims flow. For BO,
              // letting Rollup place record-list naturally avoids chunk cycles with claims.
              if (surfaceTarget !== 'bo' && id.includes('/src/shared/core/recordList/')) return 'record-list-core';

              // Keep BO-specific feature chunks isolated to reduce cross-surface shell growth.
              if (surfaceTarget === 'bo' && id.includes('/src/')) {
                if (id.includes('/src/products/policies/underwriting/workspace/')) return 'bo-uw-workspace';
              }
              if (!id.includes('node_modules')) return;
              // Core react/runtime
              if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router-dom/')) return 'react-vendor';
              // UI/animation/state/query
              if (
                id.includes('/framer-motion/') ||
                id.includes('/lucide-react/') ||
                id.includes('/@tanstack/react-query/')
              ) return 'ui-vendor';
              // Data/validation/utils
              if (
                id.includes('/zod/') ||
                id.includes('/zustand/') ||
                id.includes('/clsx/') ||
                id.includes('/tailwind-merge/')
              ) return 'utils-vendor';
            }
          }
        }
      }
    };
});
