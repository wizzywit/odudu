import { glob, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Reads the flat, two-space list under pnpm-workspace.yaml's top-level
// `packages:` key. Not a general YAML parser: this file's shape (a plain
// list of single-quoted globs) is the contract, not YAML's.
function parseWorkspaceGlobs(yaml: string): string[] {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => line.trim() === 'packages:');
  if (start === -1) {
    throw new Error('pnpm-workspace.yaml: no packages: list');
  }
  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+-\s*'([^']+)'\s*$/.exec(line);
    const glob = match?.[1];
    if (glob === undefined) break;
    globs.push(glob);
  }
  return globs;
}

async function hasTestScript(packageJsonPath: string): Promise<boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const { scripts }: Record<string, unknown> = parsed as Record<string, unknown>;
  if (typeof scripts !== 'object' || scripts === null) return false;
  return typeof (scripts as Record<string, unknown>).test === 'string';
}

// Every directory a workspace glob resolves to. `tests` is a literal entry
// in pnpm-workspace.yaml rather than a glob, so it is not expanded through
// `glob()` — a pattern with no `*` names one directory directly.
async function workspacePackageDirs(root: string): Promise<string[]> {
  const globs = parseWorkspaceGlobs(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'));
  const dirs: string[] = [];
  for (const pattern of globs) {
    if (pattern.includes('*')) {
      for await (const path of glob(join(root, pattern, 'package.json'))) {
        dirs.push(dirname(path));
      }
    } else {
      dirs.push(join(root, pattern));
    }
  }
  return dirs;
}

// Every workspace package that owns a `test` script, and so is expected to
// have written its own trace-report.json — a package with no test script
// (@odudu/testkit, @odudu/commit-message) has nothing to reconcile and
// names no report.
export async function expectedReportPaths(root: string): Promise<string[]> {
  const dirs = await workspacePackageDirs(root);
  const expected: string[] = [];
  for (const dir of dirs) {
    if (await hasTestScript(join(dir, 'package.json'))) {
      expected.push(join(dir, 'trace-report.json'));
    }
  }
  expected.sort();
  return expected;
}

// With no paths named, every workspace package's report must be present —
// a partial `pnpm test` run that skipped a package used to be reconciled as
// if that package did not exist, rather than refused. Naming paths on the
// command line stays selective: no completeness check applies to them.
export async function reportPaths(root: string, named: readonly string[]): Promise<string[]> {
  if (named.length > 0) return [...named];
  const expected = await expectedReportPaths(root);
  const missing: string[] = [];
  for (const path of expected) {
    try {
      await stat(path);
    } catch {
      missing.push(path);
    }
  }
  if (missing.length > 0) {
    throw new Error(`missing test report(s), run \`pnpm test\` first: ${missing.join(', ')}`);
  }
  return expected;
}
