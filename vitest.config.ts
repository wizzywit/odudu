import { join, relative } from 'node:path';
import { defineConfig } from 'vitest/config';
import { reactCompiler } from './apps/admin-console/reactCompiler.ts';

const REPO_ROOT = import.meta.dirname;
const SETUP = [join(REPO_ROOT, 'tests/setup/runtime-warnings.ts')];
const INTEGRATION_SETUP = [...SETUP, join(REPO_ROOT, 'tests/setup/console-client-key.ts')];
const CONSOLE = 'apps/admin-console';

// Run from the repository root this config covers every package; run from a
// package directory, as each package's `test` script does, it covers that
// package alone, so each package's results can be cached on their own.
const scope = relative(REPO_ROOT, process.cwd());

function globs(): { unit: string[]; integration: string[]; dom: string[]; plans: string[] } {
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
      plans: ['{packages,apps}/*/tests/**/*.plan.test.ts'],
    };
  }
  if (scope === 'tests') return { unit: ['**/*.test.ts'], integration: [], dom: [], plans: [] };
  if (scope === CONSOLE) {
    return { unit: [], integration: [], dom: ['src/**/*.test.{ts,tsx}'], plans: [] };
  }
  return {
    unit: ['src/**/*.test.{ts,tsx}'],
    integration: ['tests/**/*.int.test.ts', 'src/**/*.int.test.ts'],
    dom: [],
    plans: ['tests/**/*.plan.test.ts'],
  };
}

const { unit, integration, dom, plans } = globs();
// The query-plan check seeds millions of rows and takes minutes, so it runs
// only where it is asked for (`pnpm test:plans`), in a job of its own.
const planFiles = process.env.ODUDU_QUERY_PLANS === '1' ? plans : [];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: unit,
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/fixtures/**',
            '**/*.int.test.ts',
            `${CONSOLE}/**`,
          ],
          environment: 'node',
          setupFiles: SETUP,
        },
      },
      {
        test: {
          name: 'integration',
          include: integration,
          environment: 'node',
          setupFiles: INTEGRATION_SETUP,
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'plans',
          include: planFiles,
          environment: 'node',
          setupFiles: INTEGRATION_SETUP,
          testTimeout: 300_000,
          hookTimeout: 600_000,
          fileParallelism: false,
        },
      },
      {
        // The tests run the console as it is built: compiled.
        plugins: [reactCompiler()],
        test: {
          name: 'dom',
          include: dom,
          exclude: ['**/node_modules/**', '**/dist/**'],
          environment: 'jsdom',
          // An unprocessed CSS file imports as '', even with ?raw; the contrast,
          // font and layout tests read these files' source.
          css: {
            include: [
              /\/shared\/view\/(?:tokens\.css|fonts\.css|[\w/]+\.module\.css\?raw)/u,
              /\/features\/[\w-]+\/view\/[\w/]+\.module\.css\?raw/u,
            ],
          },
          setupFiles: [...SETUP, join(REPO_ROOT, CONSOLE, 'tests/setup.ts')],
          // axe over several states in both themes takes five seconds or more
          // on a busy runner; a hang is still caught by each find's own limit.
          testTimeout: 30_000,
        },
      },
    ],
  },
});
