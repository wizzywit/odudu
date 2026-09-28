import { join, relative } from 'node:path';
import { defineConfig } from 'vitest/config';

const REPO_ROOT = import.meta.dirname;
const SETUP = [join(REPO_ROOT, 'tests/setup/runtime-warnings.ts')];
const CONSOLE = 'apps/admin-console';

// Run from the repository root this config covers every package; run from a
// package directory, as each package's `test` script does, it covers that
// package alone, so each package's results can be cached on their own.
const scope = relative(REPO_ROOT, process.cwd());

function globs(): { unit: string[]; integration: string[]; dom: string[] } {
  if (scope === '') {
    return {
      unit: [
        '{packages,apps}/*/src/**/*.test.{ts,tsx}',
        'tools/*/src/**/*.test.ts',
        'tests/**/*.test.ts',
      ],
      integration: [
        '{packages,apps}/*/tests/**/*.int.test.ts',
        '{packages,apps}/*/src/**/*.int.test.ts',
      ],
      dom: [`${CONSOLE}/src/**/*.test.{ts,tsx}`],
    };
  }
  if (scope === 'tests') return { unit: ['**/*.test.ts'], integration: [], dom: [] };
  if (scope === CONSOLE) return { unit: [], integration: [], dom: ['src/**/*.test.{ts,tsx}'] };
  return {
    unit: ['src/**/*.test.{ts,tsx}'],
    integration: ['tests/**/*.int.test.ts', 'src/**/*.int.test.ts'],
    dom: [],
  };
}

const { unit, integration, dom } = globs();

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: unit,
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts', `${CONSOLE}/**`],
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
      {
        test: {
          name: 'dom',
          include: dom,
          exclude: ['**/node_modules/**', '**/dist/**'],
          environment: 'jsdom',
          // An unprocessed CSS file imports as '', even with ?raw; the contrast
          // and font tests read these two files' source.
          css: { include: [/\/shared\/view\/(?:tokens|fonts)\.css/u] },
          setupFiles: [...SETUP, join(REPO_ROOT, CONSOLE, 'tests/setup.ts')],
        },
      },
    ],
  },
});
