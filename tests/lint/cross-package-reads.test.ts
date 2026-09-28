import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Each package's `test` task is cached on its own inputs (turbo.json). A file
// whose paths this check cannot bound is listed with what it reads, and each
// target must be one of those inputs: its package's own, or `$TURBO_ROOT$/…`.
const READS: readonly { file: string; targets: readonly string[] }[] = [
  { file: 'packages/db/tests/schema-drift.int.test.ts', targets: ['packages/*/src/schema/**'] },
  {
    file: 'packages/protocol-oidc/src/view/html-response.test.ts',
    targets: ['packages/*/src/view/**', 'apps/*/src/**'],
  },
  {
    file: 'packages/protocol-oidc/src/view/routes/session-cookie-authority.test.ts',
    targets: ['packages/protocol-oidc/src/view/routes/*'],
  },
  { file: 'packages/db/src/migrate.ts', targets: ['packages/db/drizzle/**'] },
  {
    file: 'packages/protocol-admin/src/view/routes/admin-tx.test.ts',
    targets: ['packages/protocol-admin/src/view/**'],
  },
  {
    file: 'packages/console-gateway/src/view/spa.test.ts',
    targets: ['packages/console-gateway/tests/fixtures/**'],
  },
  {
    file: 'apps/server/tests/console-shell.int.test.ts',
    targets: ['packages/console-gateway/tests/fixtures/**'],
  },
  {
    file: 'packages/console-gateway/src/view/api.test.ts',
    targets: ['packages/console-gateway/tests/fixtures/**'],
  },
  {
    file: 'packages/console-gateway/src/view/routes/auth.test.ts',
    targets: ['packages/console-gateway/tests/fixtures/**'],
  },
];

// A command-line entry no test imports: it reads relative to where it is run,
// and a test task never runs it. Named as an entry by its own package's `bin`
// or `scripts`, or by a script in the root `package.json` that invokes it.
const ENTRY_POINTS: readonly string[] = ['tools/trace/src/index.ts'];

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const BUILDERS = new Set(['join', 'resolve', 'dirname', 'URL']);
const PASS_THROUGH = new Set(['fileURLToPath', 'pathToFileURL']);
const READERS = new Set(['readdir', 'readdirSync', 'readFile', 'readFileSync', 'existsSync']);
const FS_PATH_CALLS = new Set([...READERS, 'join', 'resolve', 'dirname']);

function calleeName(node: ts.CallExpression | ts.NewExpression): string {
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText();
}

function hasImportMetaOrCwd(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (
      ts.isMetaProperty(n) ||
      (ts.isCallExpression(n) && n.expression.getText() === 'process.cwd')
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

// An exported binding built from `import.meta` or `process.cwd()` is a root
// for whatever file imports it. This file's own follow-through cannot see
// that importer, so the export is treated as escaping outright rather than
// resolved against this file's own, usually shallower, uses.
function hasExportedEscapingRoot(source: string): boolean {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer && hasImportMetaOrCwd(decl.initializer)) found = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// Every path the file builds from `import.meta` or `process.cwd()`, relative
// to the file's directory, followed up the tree from each root, plus every
// relative string literal passed as the first argument of an `fs` or `path`
// call with no such root — it resolves against the process's cwd instead.
// Anything the walk does not model — a concatenation, a template, an options
// object, any other call — is `unknown`. A `for…of` variable names one
// directory entry.
export function reachesOf(source: string): string[] {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  const nodes: ts.Node[] = [];
  const collect = (node: ts.Node): void => {
    nodes.push(node);
    ts.forEachChild(node, collect);
  };
  collect(file);
  const consts = new Map<string, ts.Expression>();
  const loopVars = new Set<string>();
  for (const node of nodes) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      consts.set(node.name.text, node.initializer);
    }
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
      const names = node.initializer.declarations.map((d) => d.name);
      for (const name of names) if (ts.isIdentifier(name)) loopVars.add(name.text);
    }
  }
  const segment = (arg: ts.Expression): string | undefined => {
    const init = ts.isIdentifier(arg) ? consts.get(arg.text) : arg;
    if (init !== undefined && ts.isStringLiteralLike(init)) return init.text;
    let root = arg;
    while (ts.isPropertyAccessExpression(root)) root = root.expression;
    return ts.isIdentifier(root) && loopVars.has(root.text) ? '*' : undefined;
  };
  const follow = (node: ts.Expression, value: string, seen: readonly string[]): string[] => {
    const parent = node.parent;
    if (ts.isParenthesizedExpression(parent)) return follow(parent, value, seen);
    if (ts.isExpressionStatement(parent)) return [value];
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      const name = parent.name.text;
      const uses = nodes.filter(
        (n): n is ts.Identifier => ts.isIdentifier(n) && n.text === name && n !== parent.name,
      );
      if (seen.includes(name) || uses.length === 0) return [value];
      return uses.flatMap((use) => follow(use, value, [...seen, name]));
    }
    if (!ts.isCallExpression(parent) && !ts.isNewExpression(parent)) return ['unknown'];
    const name = calleeName(parent);
    const args = [...(parent.arguments ?? [])];
    if (PASS_THROUGH.has(name) && args[0] === node) return follow(parent, value, seen);
    if (READERS.has(name) && args[0] === node) return [value];
    if (!BUILDERS.has(name) || args.indexOf(node) !== (name === 'URL' ? 1 : 0)) return ['unknown'];
    const rest = name === 'URL' ? args.slice(0, 1) : name === 'dirname' ? [] : args.slice(1);
    const segments = rest.map(segment);
    if (segments.some((s) => s === undefined)) return ['unknown'];
    const self = value.endsWith('__self__') && (name === 'URL' || name === 'dirname');
    const from = self ? path.posix.dirname(value) : name === 'dirname' ? `${value}/..` : value;
    const next = path.posix.normalize(path.posix.join(from, ...(segments as string[])));
    return follow(parent, next, seen);
  };
  const metaReaches = nodes.flatMap((node) => {
    if (ts.isCallExpression(node) && node.expression.getText() === 'process.cwd')
      return ['unknown'];
    if (!ts.isMetaProperty(node)) return [];
    const parent = node.parent;
    if (!ts.isPropertyAccessExpression(parent) || !['dirname', 'url'].includes(parent.name.text)) {
      return ['unknown'];
    }
    return follow(parent, parent.name.text === 'url' ? '__self__' : '.', []);
  });
  const literalReaches = nodes.flatMap((node) => {
    if (!ts.isCallExpression(node) || !FS_PATH_CALLS.has(calleeName(node))) return [];
    const [arg] = node.arguments;
    return arg && ts.isStringLiteralLike(arg) && arg.text.startsWith('..') ? [arg.text] : [];
  });
  return [...metaReaches, ...literalReaches];
}

export function escapesPackage(source: string, fileWithinPackage: string): boolean {
  if (hasExportedEscapingRoot(source)) return true;
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

// A glob target is covered only by an input ending in `/**` above it, so a
// recursive read is never covered by a narrower input. `inputs` are
// relative to `packageDir` unless rooted at `$TURBO_ROOT$`.
export function isCovered(target: string, packageDir: string, inputs: readonly string[]): boolean {
  return inputs
    .map((input) =>
      input.startsWith('$TURBO_ROOT$/') ? input.slice(13) : path.posix.join(packageDir, input),
    )
    .some((input) =>
      target.includes('*')
        ? target === input || (input.endsWith('/**') && target.startsWith(input.slice(0, -2)))
        : path.matchesGlob(target, input),
    );
}

// Whether one of `candidates` (a path relative to the entry's own package,
// and the path relative to the repo root) names the entry in a `bin` value,
// one of the package's own `scripts`, or one of the root `package.json`'s.
export function isNamedEntry(
  candidates: readonly string[],
  pkg: { bin?: string | Record<string, string>; scripts?: Record<string, string> },
  rootScripts: Record<string, string> = {},
): boolean {
  const bin = pkg.bin;
  const values = [
    ...(typeof bin === 'string' ? [bin] : Object.values(bin ?? {})),
    ...Object.values(pkg.scripts ?? {}),
    ...Object.values(rootScripts),
  ].map((v) => v.replace(/^\.\//, ''));
  return candidates.some((candidate) => values.some((v) => v.includes(candidate)));
}

// Every static and dynamic import specifier in the file, exactly as written
// — quote style and extension included, and dynamic `import()` alongside
// `import`/`export … from`.
export function importSpecifiers(source: string): string[] {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteralLike(arg)) specifiers.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

// Whether `source`, read from `importingFile` (a path relative to the repo
// root), resolves a relative import specifier to `entry` (also repo-root
// relative), ignoring a `.js`/`.ts` extension on either side.
export function importsEntry(source: string, importingFile: string, entry: string): boolean {
  const noExt = (p: string): string => p.replace(/\.(js|ts)$/, '');
  const target = noExt(entry);
  const dir = path.posix.dirname(importingFile);
  return importSpecifiers(source).some((spec) => {
    if (!spec.startsWith('.')) return false;
    const resolved = path.posix.normalize(path.posix.join(dir, spec));
    return noExt(resolved) === target;
  });
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
}

function testInputs(packageDir: string): readonly string[] {
  const { name } = readJson(`${packageDir}/package.json`) as { name: string };
  const { tasks } = readJson('turbo.json') as { tasks: Record<string, { inputs?: string[] }> };
  return (tasks[`${name}#test`] ?? tasks.test)?.inputs ?? [];
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
    ["join(import.meta.dirname + '/..', '..', '..');", 'src/x.ts', true],
    ["readFileSync(import.meta.dirname + '/../../../x');", 'src/x.ts', true],
    ["const up = (p) => join(p, '..'); up(up(import.meta.dirname));", 'src/x.ts', true],
    ['const { dirname: d } = import.meta; readdir(d);', 'src/x.ts', true],
    ['readdir(String(import.meta.dirname));', 'src/x.ts', true],
    ["glob('../../../docs/**', { cwd: import.meta.dirname });", 'src/x.ts', true],
    ['export const ROOT = import.meta.dirname;', 'src/x.ts', true],
    ['const ROOT = import.meta.dirname;', 'src/x.ts', false],
    ['export const ROOT = process.cwd();', 'src/x.ts', true],
    ["readFileSync('../../../docs/x');", 'src/x.ts', true],
    ["resolve('../../docs');", 'src/x.ts', true],
    ["readFileSync('../fixtures/data.json');", 'src/view/x.test.ts', false],
  ])('%s from %s: %s', (source, file, expected) => {
    expect(escapesPackage(source, file)).toBe(expected);
  });
});

describe('isCovered', () => {
  it.each([
    ['packages/db/src/schema/tenants.ts', ['$TURBO_ROOT$/packages/*/src/schema/**'], true],
    ['packages/*/src/schema/**', ['$TURBO_ROOT$/packages/*/src/schema/**'], true],
    ['packages/x/src/view/a.ts', ['src/**'], true],
    ['packages/db/src/other', ['src/**', '$TURBO_ROOT$/packages/*/src/schema/**'], false],
    ['packages/*/src/**', ['$TURBO_ROOT$/packages/*/src/*'], false],
  ])('%s under %j: %s', (target, inputs, expected) => {
    expect(isCovered(target, 'packages/x', inputs)).toBe(expected);
  });
});

describe('isNamedEntry', () => {
  it.each([
    [['src/index.ts'], { bin: { 'odudu-trace': './src/index.ts' } }, {}, true],
    [['src/index.ts'], { scripts: { start: 'node src/index.ts' } }, {}, true],
    [
      ['tools/trace/src/index.ts'],
      {},
      { trace: 'ODUDU_TRACE_STRICT=1 node tools/trace/src/index.ts' },
      true,
    ],
    [['src/index.ts'], {}, {}, false],
  ] as const)('%j named by %j / root %j: %s', (candidates, pkg, root, expected) => {
    expect(isNamedEntry(candidates, pkg, root)).toBe(expected);
  });
});

describe('importsEntry', () => {
  const entry = 'tools/trace/src/index.ts';
  it.each([
    ["import { run } from '../src/index';", 'tools/trace/tests/x.test.ts', true],
    ['import "../src/index.js";', 'tools/trace/tests/x.test.ts', true],
    ["import('../src/index');", 'tools/trace/tests/x.test.ts', true],
    ["import x from './index';", 'tools/trace/src/other.ts', true],
    ["import x from '../../../tools/trace/src/index';", 'apps/server/src/x.ts', true],
    ["import { other } from './other';", 'tools/trace/tests/x.test.ts', false],
    ["import x from '@odudu/db';", 'tools/trace/tests/x.test.ts', false],
  ])('%s from %s: %s', (source, importingFile, expected) => {
    expect(importsEntry(source, importingFile, entry)).toBe(expected);
  });
});

describe('a file whose reads this check cannot bound', () => {
  it.each(READS)('$file is still one, and its inputs cover each target', (entry) => {
    const [top = '', dir = '', ...rest] = entry.file.split('/');
    const source = readFileSync(path.join(REPO_ROOT, entry.file), 'utf8');
    expect(escapesPackage(source, rest.join('/'))).toBe(true);
    const inputs = testInputs(`${top}/${dir}`);
    expect(entry.targets.filter((t) => !isCovered(t, `${top}/${dir}`, inputs))).toEqual([]);
  });

  it.each(ENTRY_POINTS)(
    '%s is a named entry, still escapes, and nothing imports it',
    { timeout: 60_000 },
    async (entry) => {
      expect(existsSync(path.join(REPO_ROOT, entry))).toBe(true);
      const packageDir = entry.split('/').slice(0, 2).join('/');
      const pkg = readJson(`${packageDir}/package.json`) as {
        bin?: string | Record<string, string>;
        scripts?: Record<string, string>;
      };
      const root = readJson('package.json') as { scripts?: Record<string, string> };
      const relative = path.posix.relative(packageDir, entry);
      expect(isNamedEntry([relative, entry], pkg, root.scripts)).toBe(true);

      const entrySource = readFileSync(path.join(REPO_ROOT, entry), 'utf8');
      expect(escapesPackage(entrySource, relative)).toBe(true);

      const candidates: string[] = [];
      for await (const file of glob('{packages,apps,tools}/*/{src,tests}/**/*.ts', {
        cwd: REPO_ROOT,
      })) {
        candidates.push(file);
      }
      for await (const file of glob('tests/**/*.ts', { cwd: REPO_ROOT })) {
        candidates.push(file);
      }
      for (const file of candidates) {
        const posix = file.split(path.sep).join('/');
        const source = readFileSync(path.join(REPO_ROOT, posix), 'utf8');
        expect(importsEntry(source, posix, entry), posix).toBe(false);
      }
    },
  );

  it('is listed, in every package, app and tool', { timeout: 60_000 }, async () => {
    const listed = new Set([...READS.map((entry) => entry.file), ...ENTRY_POINTS]);
    const offenders: string[] = [];
    let scanned = 0;
    for await (const file of glob('{packages,apps,tools}/*/{src,tests}/**/*.ts', {
      cwd: REPO_ROOT,
    })) {
      scanned += 1;
      const posix = file.split(path.sep).join('/');
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      const within = posix.split('/').slice(2).join('/');
      if (!listed.has(posix) && escapesPackage(source, within)) offenders.push(posix);
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders, 'list each in READS with what it reads').toEqual([]);
  });
});
