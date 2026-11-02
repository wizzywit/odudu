import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.docusaurus/**',
      '**/.lighthouseci/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'tests/boundaries/fixtures/**',
      'tests/lint/fixtures/**',
      // Standalone projects with their own lockfiles, copied out of the
      // repository by readers; the examples job runs them.
      'examples/**',
    ],
  },
  // A disable comment that no longer suppresses anything is a claim about the
  // code that has quietly stopped being true; failing on it keeps the small
  // number of live suppressions honest and reviewable.
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '*.config.js',
            '*.config.ts',
            'packages/*/*.config.ts',
            // site.config.ts is imported by the docs app's tests, so the project
            // service already owns it; matching it here too is a parse error.
            'apps/*/!(site).config.ts',
            '.dependency-cruiser.cjs',
            '.dependency-cruiser-resolve.cjs',
          ],
          defaultProject: 'tsconfig.base.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          // Fastify's register() returns the instance, which is thenable only
          // so that `await app.register(...)` can force plugin readiness.
          // Registration itself is deferred until listen()/ready(), so leaving
          // the call unawaited is the ordinary usage, not a dropped promise.
          //
          // QueryClient.invalidateQueries (@tanstack/query-core 5.104.0) resolves
          // once the refetch settles and never rejects on a query's failure
          // unless throwOnError is set: refetchQueries puts promise.catch(noop)
          // on each fetch (build/modern/queryClient.js, lines 331-341). The
          // console passes none, so leaving it unawaited drops no error.
          allowForKnownSafeCalls: [
            { from: 'package', package: 'fastify', name: 'register' },
            { from: 'package', package: '@tanstack/query-core', name: 'invalidateQueries' },
          ],
        },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['apps/admin-console/**/*.{ts,tsx}', 'apps/docs/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    // `eslint .` passes on a warning, so a finding at warning severity would ship.
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/incompatible-library': 'error',
      'react-hooks/unsupported-syntax': 'error',
    },
  },
  {
    // A usecase or repository decides nothing (ADR 0010's amendment), and a
    // function this branchy is deciding: the decision is a service function.
    files: [
      'apps/admin-console/src/**/{use-cases,repository}/**/*.ts',
      'apps/docs/src/**/usecase/**/*.ts',
    ],
    ignores: ['**/*.test.ts'],
    rules: { complexity: ['error', 8] },
  },
  {
    files: [
      'packages/*/src/**/*.{ts,tsx}',
      'apps/*/src/**/*.{ts,tsx}',
      'packages/*/tests/**/*.{ts,tsx}',
      'apps/*/tests/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\.?(/|$)',
              message: 'Use #/ subpath imports (ADR 0013), not relative paths.',
            },
          ],
        },
      ],
    },
  },
);
