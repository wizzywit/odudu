import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reportPaths } from '#/report-paths';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

interface FixturePackage {
  dir: string;
  hasTestScript: boolean;
  hasReport: boolean;
}

// A minimal workspace: pnpm-workspace.yaml naming the same globs this repo
// does, plus one package per fixture entry, each with or without a `test`
// script and a trace-report.json as the test wants.
async function fixtureWorkspace(packages: FixturePackage[]): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'odudu-trace-workspace-'));
  await writeFile(
    join(root, 'pnpm-workspace.yaml'),
    "packages:\n  - 'apps/*'\n  - 'packages/*'\n  - 'tools/*'\n  - 'tests'\n",
  );
  for (const pkg of packages) {
    const dir = join(root, pkg.dir);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: pkg.dir.replace('/', '-'),
        scripts: pkg.hasTestScript ? { test: 'vitest run' } : {},
      }),
    );
    if (pkg.hasReport) {
      await writeFile(join(dir, 'trace-report.json'), '{}');
    }
  }
  return root;
}

describe('reportPaths — default branch', () => {
  it('rejects, naming the package, when a package with a test script has no report', async () => {
    const workspace = await fixtureWorkspace([
      { dir: 'packages/account', hasTestScript: true, hasReport: true },
      { dir: 'packages/testkit', hasTestScript: false, hasReport: false },
      { dir: 'tools/trace', hasTestScript: true, hasReport: false },
    ]);

    await expect(reportPaths(workspace, [])).rejects.toThrow(/tools\/trace\/trace-report\.json/);
  });

  it('accepts when every package with a test script has a report', async () => {
    const workspace = await fixtureWorkspace([
      { dir: 'packages/account', hasTestScript: true, hasReport: true },
      { dir: 'packages/testkit', hasTestScript: false, hasReport: false },
      { dir: 'tests', hasTestScript: true, hasReport: true },
    ]);

    await expect(reportPaths(workspace, [])).resolves.toEqual(
      [
        join(workspace, 'packages/account/trace-report.json'),
        join(workspace, 'tests/trace-report.json'),
      ].sort(),
    );
  });

  it('does not check completeness when paths are named explicitly', async () => {
    const workspace = await fixtureWorkspace([
      { dir: 'tools/trace', hasTestScript: true, hasReport: false },
    ]);

    await expect(reportPaths(workspace, ['some/report.json'])).resolves.toEqual([
      'some/report.json',
    ]);
  });
});
