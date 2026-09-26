import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Each package's `test` task is cached on that package's own files (turbo.json).
// A file that builds a path climbing above its package root reads something
// the cache key does not cover, so a change there would replay a stale pass —
// unless the package has a `<name>#test` override whose inputs name files
// through `$TURBO_ROOT$`, as @odudu/db's and @odudu/protocol-oidc's do.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PATH_BUILDERS = new Set(['join', 'resolve']);

function leadingParentSegments(text: string): number {
  let count = 0;
  for (const segment of text.split('/')) {
    if (segment !== '..') break;
    count += 1;
  }
  return count;
}

function calleeName(node: ts.CallExpression | ts.NewExpression): string | undefined {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

// The most `..` segments any one `join(…)`, `resolve(…)` or `new URL(…)`
// call puts in its string arguments: how far above its own directory the
// file reaches.
export function deepestClimb(source: string): number {
  let deepest = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = calleeName(node);
      if (name !== undefined && (PATH_BUILDERS.has(name) || name === 'URL')) {
        let climb = 0;
        for (const arg of node.arguments ?? []) {
          if (ts.isStringLiteralLike(arg)) climb += leadingParentSegments(arg.text);
        }
        deepest = Math.max(deepest, climb);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true));
  return deepest;
}

export function escapesPackage(source: string, fileWithinPackage: string): boolean {
  const depth = path.posix
    .dirname(fileWithinPackage)
    .split('/')
    .filter((s) => s !== '.').length;
  return deepestClimb(source) > depth;
}

function overridesReachingOut(): Set<string> {
  const turbo: unknown = JSON.parse(readFileSync(path.join(REPO_ROOT, 'turbo.json'), 'utf8'));
  const tasks = (turbo as { tasks?: Record<string, { inputs?: unknown }> }).tasks ?? {};
  const names = new Set<string>();
  for (const [id, task] of Object.entries(tasks)) {
    if (!id.endsWith('#test') || !Array.isArray(task.inputs)) continue;
    if (task.inputs.some((i) => typeof i === 'string' && i.startsWith('$TURBO_ROOT$/'))) {
      names.add(id.slice(0, -'#test'.length));
    }
  }
  return names;
}

function packageName(packageDir: string): string {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(REPO_ROOT, packageDir, 'package.json'), 'utf8'),
  );
  const name: unknown = (manifest as { name?: unknown }).name;
  if (typeof name !== 'string') throw new Error(`${packageDir}/package.json has no name`);
  return name;
}

describe('deepestClimb', () => {
  it('counts the segments of one path literal', () => {
    expect(deepestClimb("new URL('../../..', import.meta.url);")).toBe(3);
  });

  it('adds up separate segment arguments to one call', () => {
    expect(deepestClimb("join(import.meta.dirname, '..', '..', '..', '..');")).toBe(4);
  });

  it('ignores a traversal string that no path is built from', () => {
    expect(deepestClimb("const payloads = ['../../../etc/passwd'];")).toBe(0);
  });
});

describe('escapesPackage', () => {
  it('flags a climb above the package root', () => {
    expect(
      escapesPackage("join(import.meta.dirname, '..', '..', '..')", 'src/view/x.test.ts'),
    ).toBe(true);
  });

  it('allows a climb that stays inside the package', () => {
    expect(escapesPackage("new URL('../drizzle', import.meta.url)", 'src/migrate.ts')).toBe(false);
  });
});

describe('a file that reads above its package root has a turbo.json test override', () => {
  it('holds for every package, app and tool', async () => {
    const overrides = overridesReachingOut();
    const offenders: string[] = [];
    let scanned = 0;
    for await (const file of glob('{packages,apps,tools}/*/{src,tests}/**/*.ts', {
      cwd: REPO_ROOT,
    })) {
      scanned += 1;
      const [top = '', dir = '', ...rest] = file.split(path.sep);
      const packageDir = `${top}/${dir}`;
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      if (!escapesPackage(source, rest.join('/'))) continue;
      const name = packageName(packageDir);
      if (overrides.has(name)) continue;
      offenders.push(
        `${file} builds a path above ${packageDir}; add a "${name}#test" task to ` +
          'turbo.json that copies the generic "test" task and adds the files it reads ' +
          'as "$TURBO_ROOT$/…" inputs',
      );
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});
