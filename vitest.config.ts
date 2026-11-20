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

const REACT_SDK = 'sdks/react';

// The server's command imports the stdio client's package root. Tests read it as
// source, so they need no build of the package in front of them. Its `./internal`
// subpath is source already.
const MCP_STDIO_SOURCE = {
  alias: [
    {
      find: /^@odudu-io\/mcp-stdio$/u,
      replacement: join(REPO_ROOT, 'sdks/mcp-stdio/src/index.ts'),
    },
  ],
};

function globs(): {
  unit: string[];
  integration: string[];
  dom: string[];
  sdkDom: string[];
  plans: string[];
} {
  if (scope === '') {
    return {
      unit: [
        '{packages,apps}/*/src/**/*.test.{ts,tsx}',
        'tools/*/src/**/*.test.ts',
        'sdks/*/src/**/*.test.ts',
        'tests/**/*.test.ts',
      ],
      integration: [
        '{packages,apps}/*/tests/**/*.int.test.ts',
        '{packages,apps}/*/src/**/*.int.test.ts',
      ],
      dom: [`${CONSOLE}/src/**/*.test.{ts,tsx}`],
      sdkDom: [`${REACT_SDK}/src/**/*.test.tsx`],
      plans: ['{packages,apps}/*/tests/**/*.plan.test.ts'],
    };
  }
  if (scope === 'tests') {
    return { unit: ['**/*.test.ts'], integration: [], dom: [], sdkDom: [], plans: [] };
  }
  if (scope === 'apps/docs') {
    return {
      unit: ['tests/**/*.test.ts', 'scripts/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
      integration: [],
      dom: [],
      sdkDom: [],
      plans: [],
    };
  }
  if (scope === CONSOLE) {
    return {
      unit: [],
      integration: [],
      dom: ['src/**/*.test.{ts,tsx}'],
      sdkDom: [],
      plans: [],
    };
  }
  if (scope === REACT_SDK) {
    return {
      unit: ['src/**/*.test.ts'],
      integration: [],
      dom: [],
      sdkDom: ['src/**/*.test.tsx'],
      plans: [],
    };
  }
  return {
    unit: ['src/**/*.test.{ts,tsx}'],
    integration: ['tests/**/*.int.test.ts', 'src/**/*.int.test.ts'],
    dom: [],
    sdkDom: [],
    plans: ['tests/**/*.plan.test.ts'],
  };
}

const { unit, integration, dom, sdkDom, plans } = globs();
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
        resolve: {
          alias: [
            ...MCP_STDIO_SOURCE.alias,
            ...Object.entries(DOCS_ALIAS.alias).map(([find, replacement]) => ({
              find,
              replacement,
            })),
          ],
        },
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
        resolve: MCP_STDIO_SOURCE,
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
              /\/shared\/ui\/(?:tokens\.css|fonts\.css|[\w/]+\.module\.css\?raw)/u,
              /\/(?:features|pages|widgets)\/[\w-]+\/ui\/[\w/]+\.module\.css\?raw/u,
            ],
          },
          setupFiles: [...SETUP, join(REPO_ROOT, CONSOLE, 'tests/setup.ts')],
          // axe over several states in both themes takes five seconds or more
          // on a busy runner; a hang is still caught by each find's own limit.
          testTimeout: 30_000,
        },
      },
      {
        // The React SDK's hooks and components, compiled as a consumer's build
        // would compile them, in a page of their own.
        plugins: [reactCompiler()],
        test: {
          name: 'sdk-dom',
          include: sdkDom,
          exclude: ['**/node_modules/**', '**/dist/**'],
          environment: 'jsdom',
          setupFiles: [...SETUP, join(REPO_ROOT, REACT_SDK, 'test/setup.ts')],
          testTimeout: 15_000,
        },
      },
    ],
  },
});
