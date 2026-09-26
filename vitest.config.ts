import { join, relative } from 'node:path';
import { defineConfig } from 'vitest/config';

const REPO_ROOT = import.meta.dirname;
const SETUP = [join(REPO_ROOT, 'tests/setup/runtime-warnings.ts')];

// Run from the repository root this config covers every package; run from a
// package directory, as each package's `test` script does, it covers that
// package alone, so each package's results can be cached on their own.
const scope = relative(REPO_ROOT, process.cwd());

function globs(): { unit: string[]; integration: string[] } {
  if (scope === '') {
    return {
      unit: [
        '{packages,apps}/*/src/**/*.test.ts',
        'tools/*/src/**/*.test.ts',
        'tests/**/*.test.ts',
      ],
      integration: [
        '{packages,apps}/*/tests/**/*.int.test.ts',
        '{packages,apps}/*/src/**/*.int.test.ts',
      ],
    };
  }
  if (scope === 'tests') return { unit: ['**/*.test.ts'], integration: [] };
  return {
    unit: ['src/**/*.test.ts'],
    integration: ['tests/**/*.int.test.ts', 'src/**/*.int.test.ts'],
  };
}

const { unit, integration } = globs();

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: unit,
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts'],
          environment: 'node',
          setupFiles: SETUP,
        },
      },
      {
        test: {
          name: 'integration',
          include: integration,
          environment: 'node',
          setupFiles: SETUP,
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
