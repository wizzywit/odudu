import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'tests/boundaries/fixtures/**',
      'tests/lint/fixtures/**',
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
            'apps/*/*.config.ts',
            '.dependency-cruiser.cjs',
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
          allowForKnownSafeCalls: [{ from: 'package', package: 'fastify', name: 'register' }],
        },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['apps/admin-console/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    // `eslint .` passes on a warning, so a missed dependency would ship.
    rules: { 'react-hooks/exhaustive-deps': 'error' },
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
