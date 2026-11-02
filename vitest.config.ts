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

// The docs site's own `@site/…` imports, which Docusaurus resolves, and the
// framework's components and hooks as small stand-ins, for the tests that
// render a view or a usecase.
const DOCUSAURUS_STUBS = join(REPO_ROOT, 'apps/docs/tests/support/docusaurus');
const DOCS_ALIAS = {
  alias: {
    '@site': join(REPO_ROOT, 'apps/docs'),
    '@docusaurus/Link': join(DOCUSAURUS_STUBS, 'Link.tsx'),
    '@docusaurus/Head': join(DOCUSAURUS_STUBS, 'Head.tsx'),
    '@docusaurus/useBaseUrl': join(DOCUSAURUS_STUBS, 'useBaseUrl.ts'),
    '@docusaurus/useIsBrowser': join(DOCUSAURUS_STUBS, 'useIsBrowser.ts'),
    '@docusaurus/useDocusaurusContext': join(DOCUSAURUS_STUBS, 'useDocusaurusContext.ts'),
    '@theme/Layout': join(DOCUSAURUS_STUBS, 'Layout.tsx'),
  },
};

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
  if (scope === 'apps/docs') {
    return {
      unit: ['tests/**/*.test.ts', 'scripts/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
      integration: [],
      dom: [],
      plans: [],
    };
  }
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
// Drives Chromium against the built site, so only the docs app's own
// `test:browser` runs it.
const browser =
  scope === 'apps/docs' ? ['tests/**/*.browser.test.ts', 'scripts/**/*.browser.test.ts'] : [];
// The query-plan check seeds millions of rows and takes minutes, so it runs
// only where it is asked for (`pnpm test:plans`), in a job of its own.
const planFiles = process.env.ODUDU_QUERY_PLANS === '1' ? plans : [];

// `i/n` runs the i-th of n slices of the files this run resolves. It is read
// from the environment, not the command line, so Turborepo can hash it
// (turbo.json lists it in every test task's `env`).
const shard = process.env.ODUDU_TEST_SHARD;

export default defineConfig({
  test: {
    shard: shard === undefined || shard === '' ? undefined : shard,
    projects: [
      {
        resolve: DOCS_ALIAS,
        test: {
          name: 'unit',
          include: unit,
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/fixtures/**',
            '**/*.int.test.ts',
            '**/*.browser.test.ts',
            `${CONSOLE}/**`,
          ],
          environment: 'node',
          setupFiles: SETUP,
          // The docs tests each read the whole built site, which takes longer than the
          // default when every package's tests run at once.
          ...(scope === 'apps/docs' ? { testTimeout: 30_000 } : {}),
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
        resolve: DOCS_ALIAS,
        test: {
          name: 'browser',
          include: browser,
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 60_000,
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
              /\/shared\/(?:view|ui)\/(?:tokens\.css|fonts\.css|[\w/]+\.module\.css\?raw)/u,
              /\/features\/[\w-]+\/(?:view|ui)\/[\w/]+\.module\.css\?raw/u,
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
