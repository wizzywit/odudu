import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Each package's `test` task is cached on that package's own files (turbo.json).
// A file that reads above its package root is listed here with what it reads,
// and each target must be one of that package's `$TURBO_ROOT$/…` test inputs,
// or a change there would replay a stale pass.
const READS_OUTSIDE: readonly { file: string; targets: readonly string[] }[] = [
  { file: 'packages/db/tests/schema-drift.int.test.ts', targets: ['packages/*/src/schema/**'] },
  {
    file: 'packages/protocol-oidc/src/view/html-response.test.ts',
    targets: ['packages/*/src/view/**', 'apps/*/src/**'],
  },
];

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const BUILDERS = new Set(['join', 'resolve', 'dirname', 'URL', 'fileURLToPath']);

function calleeName(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return undefined;
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText();
}

// Where each path a file builds from `import.meta` or `process.cwd()` points,
// relative to the file's directory: `unknown` for a segment the source does
// not fix, except a `for…of` variable, which names one directory entry and so
// is never `..`. A path handed on to another function is taken as read there.
export function reachesOf(source: string): string[] {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  const consts = new Map<string, ts.Expression>();
  const loopVars = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      consts.set(node.name.text, node.initializer);
    }
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      const names = node.initializer.declarations.map((d) => d.name);
      for (const name of names) if (ts.isIdentifier(name)) loopVars.add(name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(file);
  const segment = (arg: ts.Expression): string | undefined => {
    const init = ts.isIdentifier(arg) ? consts.get(arg.text) : arg;
    if (init !== undefined && ts.isStringLiteralLike(init)) return init.text;
    let root = arg;
    while (ts.isPropertyAccessExpression(root)) root = root.expression;
    return ts.isIdentifier(root) && loopVars.has(root.text) ? '*' : undefined;
  };
  const reach = (expr: ts.Expression, seen: readonly string[] = []): string | null => {
    if (ts.isPropertyAccessExpression(expr) && ts.isMetaProperty(expr.expression)) {
      return expr.name.text === 'url' ? '__self__' : '.';
    }
    if (ts.isIdentifier(expr)) {
      const init = consts.get(expr.text);
      return init === undefined || seen.includes(expr.text)
        ? null
        : reach(init, [...seen, expr.text]);
    }
    if (ts.isTemplateExpression(expr)) {
      return expr.templateSpans.some((s) => reach(s.expression, seen) !== null) ? 'unknown' : null;
    }
    const name = calleeName(expr);
    if (!ts.isCallExpression(expr) && !ts.isNewExpression(expr)) return null;
    if (expr.expression.getText() === 'process.cwd') return 'unknown';
    if (name === undefined || !BUILDERS.has(name)) return null;
    const args = [...(expr.arguments ?? [])];
    const baseArg = name === 'URL' ? args[1] : args[0];
    const base = baseArg === undefined ? null : reach(baseArg, seen);
    if (base === null || base === 'unknown' || name === 'fileURLToPath') return base;
    const segments = (
      name === 'URL' ? args.slice(0, 1) : name === 'dirname' ? [] : args.slice(1)
    ).map(segment);
    if (segments.some((s) => s === undefined)) return 'unknown';
    const self = base.endsWith('__self__') && (name === 'URL' || name === 'dirname');
    const from = self ? path.posix.dirname(base) : name === 'dirname' ? `${base}/..` : base;
    return path.posix.normalize(path.posix.join(from, ...(segments as string[])));
  };
  const reaches: string[] = [];
  const visit = (node: ts.Node): void => {
    const name = calleeName(node);
    if (ts.isTemplateExpression(node) || (name !== undefined && BUILDERS.has(name))) {
      const found = reach(node as ts.Expression);
      if (found !== null) reaches.push(found);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return reaches;
}

export function escapesPackage(source: string, fileWithinPackage: string): boolean {
  const depth = path.posix
    .dirname(fileWithinPackage)
    .split('/')
    .filter((s) => s !== '.').length;
  return reachesOf(source).some((reach) => {
    const segments = reach.split('/');
    const up = segments.findIndex((s) => s !== '..');
    return reach === 'unknown' || (up === -1 ? segments.length : up) > depth;
  });
}

// A target that is itself a glob is covered only by that same glob: a
// recursive read is never covered by a narrower input.
export function isCoveredByTurboInputs(target: string, inputs: readonly string[]): boolean {
  return inputs
    .filter((input) => input.startsWith('$TURBO_ROOT$/'))
    .map((input) => input.slice('$TURBO_ROOT$/'.length))
    .some(
      (input) => target === input || (!target.includes('*') && path.matchesGlob(target, input)),
    );
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
}

function testInputs(packageDir: string): readonly string[] {
  const { name } = readJson(`${packageDir}/package.json`) as { name: string };
  const { tasks } = readJson('turbo.json') as { tasks: Record<string, { inputs?: string[] }> };
  return tasks[`${name}#test`]?.inputs ?? [];
}

describe('escapesPackage', () => {
  it.each([
    ["join(import.meta.dirname, '..', '..', '..')", 'src/view/x.test.ts', true],
    ["new URL('../drizzle', import.meta.url)", 'src/migrate.ts', false],
    ["join(import.meta.dirname, 'fixtures/../../../shared/../../../../a')", 'src/view/x.ts', true],
    ["join(import.meta.dirname, '../../fixtures/..')", 'src/view/x.test.ts', false],
    ['const d = `${import.meta.dirname}/../..`;', 'src/x.ts', true],
    ["const UP = '../../..'; join(import.meta.dirname, UP);", 'src/x.ts', true],
    ['dirname(dirname(import.meta.dirname));', 'src/x.ts', true],
    ["join(process.cwd(), 'docs');", 'src/x.ts', true],
    ['const R = import.meta.dirname; join(R, name);', 'src/x.ts', true],
    ['const R = import.meta.dirname; for (const e of xs) join(R, e.name);', 'src/x.ts', false],
    ["const payloads = ['../../../etc/passwd'];", 'src/x.ts', false],
  ])('%s from %s: %s', (source, file, expected) => {
    expect(escapesPackage(source, file)).toBe(expected);
  });
});

describe('isCoveredByTurboInputs', () => {
  const inputs = ['src/**', '$TURBO_ROOT$/packages/*/src/schema/**'];
  it('covers a file the input names, and the input glob itself', () => {
    expect(isCoveredByTurboInputs('packages/db/src/schema/tenants.ts', inputs)).toBe(true);
    expect(isCoveredByTurboInputs('packages/*/src/schema/**', inputs)).toBe(true);
  });
  it('covers nothing else, nor a recursive read under a one-level glob', () => {
    expect(isCoveredByTurboInputs('packages/db/src/other', inputs)).toBe(false);
    expect(isCoveredByTurboInputs('packages/*/src/**', ['$TURBO_ROOT$/packages/*/src/*'])).toBe(
      false,
    );
    expect(isCoveredByTurboInputs('packages/db/src/schema/a.ts', [])).toBe(false);
  });
});

describe('a file that reads above its package root', () => {
  it.each(READS_OUTSIDE)('$file still does, and its turbo inputs cover each target', (entry) => {
    const [top = '', dir = '', ...rest] = entry.file.split('/');
    expect(existsSync(path.join(REPO_ROOT, entry.file))).toBe(true);
    const source = readFileSync(path.join(REPO_ROOT, entry.file), 'utf8');
    expect(escapesPackage(source, rest.join('/'))).toBe(true);
    const inputs = testInputs(`${top}/${dir}`);
    expect(entry.targets.filter((target) => !isCoveredByTurboInputs(target, inputs))).toEqual([]);
  });

  it('is listed, in every package, app and tool', { timeout: 60_000 }, async () => {
    const listed = new Set(READS_OUTSIDE.map((entry) => entry.file));
    const offenders: string[] = [];
    let scanned = 0;
    for await (const file of glob('{packages,apps,tools}/*/{src,tests}/**/*.ts', {
      cwd: REPO_ROOT,
    })) {
      scanned += 1;
      const posix = file.split(path.sep).join('/');
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      if (!listed.has(posix) && escapesPackage(source, posix.split('/').slice(2).join('/'))) {
        offenders.push(posix);
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders, 'list each in READS_OUTSIDE with what it reads').toEqual([]);
  });
});
