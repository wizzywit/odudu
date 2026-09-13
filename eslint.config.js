import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.turbo/**', '**/coverage/**', 'tests/boundaries/fixtures/**'] },
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
    files: [
      'packages/*/src/**/*.ts',
      'apps/*/src/**/*.ts',
      'packages/*/tests/**/*.ts',
      'apps/*/tests/**/*.ts',
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
