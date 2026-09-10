import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.vite/**'],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: true,
      },
    },
    rules: {
      // Block ALL console usage now that structured logging is implemented
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='console']",
          message: 'Use structured logger (Pino) instead of console.*',
        },
      ],

      '@typescript-eslint/no-explicit-any': 'error',
      // Keep assertions stylistically consistent and avoid broad object-literal
      // assertions. Promoted from `warn` to `error` in PR 3.2 of the
      // errors-and-warnings cleanup once the existing 2 hits were drained
      // (PR 2.1). New `as`-on-literal cases must split into a typed const.
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],

      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Strict equality. `warn` for now (~27 hits across the tree); promote
      // to `error` once those are drained. `null`-comparison stays loose
      // by default — matches the existing pattern of `x == null`.
      'eqeqeq': ['warn', 'always', { null: 'ignore' }],

      // Prevent accidental re-introduction of `lodash`. We declare the
      // package in `package.json` overrides only to pin a transitive
      // version; nothing in the tree actually imports it.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'lodash', message: 'Use the standard library or a focused helper; lodash is intentionally unused.' },
          ],
          patterns: [
            { group: ['lodash/*'], message: 'Use the standard library or a focused helper; lodash is intentionally unused.' },
          ],
        },
      ],

      // Guardrail: keep TS/TSX files from becoming "god files".
      // ADR-0020 Stage A: cap at 800 (warn) with the rule that any file
      // over 800 effective lines must be split (PR 2.2/2.3 already
      // drained the only offender, lloydsV52.ts). The cap lowers to
      // 700 → 600 in subsequent stages once the 600-800 long-tail is
      // also drained — the CI policy `--max-warnings=0` (see
      // `.github/workflows/ci.yml`) means the cap can only be reduced
      // when the new floor is already empty, otherwise CI breaks.
      'max-lines': ['warn', { max: 800, skipBlankLines: true, skipComments: true }],

      'import/no-cycle': 'error',

      // React hooks correctness. (Exhaustive deps starts at warn to avoid blocking refactors.)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // CLI scripts and ops tooling: console-based stdout/stderr is the contract
  // (operators pipe JSON to jq, capture stderr in pipelines). Pino is for
  // long-running service code, not one-shot scripts.
  {
    files: [
      'backend/scripts/**/*.{ts,tsx,mts,cts,js,mjs,cjs,jsx}',
      'tools/**/*.{ts,tsx,mts,cts,js,mjs,cjs,jsx}',
      'scripts/**/*.{ts,tsx,mts,cts,js,mjs,cjs,jsx}',
    ],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  // Backend layering laws (CHAMPS): http -> app -> domain -> infra.
  {
    files: ['backend/modules/*/http/**/*.{ts,tsx,js,jsx}', 'backend/http/routes/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['backend/modules/*/domain/*', '@/backend/modules/*/domain/*'],
              message: 'HTTP layer cannot import domain directly; use app use-cases.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['backend/modules/*/app/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'backend/modules/*/http/*',
                '@/backend/modules/*/http/*',
                'backend/http/routes/*',
                '@/backend/http/routes/*',
              ],
              message: 'App layer cannot import HTTP layer.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['backend/modules/*/domain/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'backend/modules/*/infra/*',
                '@/backend/modules/*/infra/*',
                'backend/modules/*/http/*',
                '@/backend/modules/*/http/*',
                'backend/http/routes/*',
                '@/backend/http/routes/*',
                'backend/platform/*',
                '@/backend/platform/*',
              ],
              message: 'Domain layer must stay pure and cannot import infra/http/core.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['backend/platform/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['backend/modules/*', '@/backend/modules/*'],
              message: 'Core layer cannot import modules.',
            },
          ],
        },
      ],
    },
  },
  // Surface boundaries (enforced by import graph, not convention).
  {
    files: ['frontend/src/surfaces/bo/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/src/surfaces/client/*',
                '@/src/surfaces/public/*',
                '@surfaces/client/*',
                '@surfaces/public/*',
                '@client/*',
                '@public/*',
              ],
              message: 'BO surface cannot import client/public surfaces.',
            },
            {
              group: ['@/src/lib/api', '@/src/lib/api/*'],
              message: 'Use surface-specific API clients instead of direct src/lib/api imports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['frontend/src/surfaces/client/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/src/surfaces/bo/*',
                '@/src/surfaces/public/*',
                '@surfaces/bo/*',
                '@surfaces/public/*',
                '@bo/*',
                '@public/*',
              ],
              message: 'Client surface cannot import BO/public surfaces.',
            },
            {
              group: ['@/src/lib/api', '@/src/lib/api/*'],
              message: 'Use surface-specific API clients instead of direct src/lib/api imports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['frontend/src/surfaces/public/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/src/surfaces/bo/*',
                '@/src/surfaces/client/*',
                '@surfaces/bo/*',
                '@surfaces/client/*',
                '@bo/*',
                '@client/*',
              ],
              message: 'Public surface cannot import BO/client surfaces.',
            },
            {
              group: ['@/src/lib/api', '@/src/lib/api/*'],
              message: 'Use surface-specific API clients instead of direct src/lib/api imports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['frontend/src/shared/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/src/products/*',
                '@/src/surfaces/*',
                '@products/*',
                '@surfaces/*',
                '@bo/*',
                '@client/*',
                '@public/*',
              ],
              message: 'Shared code cannot import product/surface modules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['frontend/src/products/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/src/surfaces/*',
                '@surfaces/*',
                '@bo/*',
                '@client/*',
                '@public/*',
              ],
              message: 'Product modules cannot import surfaces.',
            },
            {
              group: ['@/src/lib/api', '@/src/lib/api/*'],
              message: 'Use product/surface scoped API clients instead of direct src/lib/api imports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['frontend/src/products/**/api/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/src/surfaces/*',
                '@surfaces/*',
                '@bo/*',
                '@client/*',
                '@public/*',
              ],
              message: 'Product API modules cannot import surfaces.',
            },
          ],
        },
      ],
    },
  },
  // Backend type-aware lint. Slow (parses each file with the TS program)
  // but the only way to catch unhandled promises — a real bug class in
  // a Node + Express + pino + bullmq stack. Scoped to backend production
  // code only; tests + scripts are excluded so the slow type-aware
  // pass doesn't dominate `npm run lint`.
  //
  // Promoted from `warn` to `error` in sprint follow-up F2 once the 39
  // existing hits were drained (sprint follow-up F1a/b/c). Fire-and-
  // forget call sites use the explicit `void` operator; deliberate
  // background work uses `.catch(() => …)` to mark its rejection
  // handling. `await` is the default for anything caller-synchronous.
  {
    files: ['backend/**/*.ts'],
    ignores: ['backend/**/__tests__/**', 'backend/**/*.test.ts', 'backend/dist/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./backend/tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
];

