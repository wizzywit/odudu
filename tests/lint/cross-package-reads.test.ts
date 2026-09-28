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
];

// A command-line entry no test imports: it reads relative to where it is run,
// and a test task never runs it.
const ENTRY_POINTS: readonly string[] = ['tools/trace/src/index.ts'];

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const BUILDERS = new Set(['join', 'resolve', 'dirname', 'URL']);
const PASS_THROUGH = new Set(['fileURLToPath', 'pathToFileURL']);
const READERS = new Set(['readdir', 'readdirSync', 'readFile', 'readFileSync', 'existsSync']);

function calleeName(node: ts.CallExpression | ts.NewExpression): string {
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText();
}

// Every path the file builds from `import.meta` or `process.cwd()`, relative
// to the file's directory, followed up the tree from each root. Anything the
// walk does not model — a concatenation, a template, an options object, any
// other call — is `unknown`. A `for…of` variable names one directory entry.
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
  return nodes.flatMap((node) => {
    if (ts.isCallExpression(node) && node.expression.getText() === 'process.cwd')
      return ['unknown'];
    if (!ts.isMetaProperty(node)) return [];
    const parent = node.parent;
    if (!ts.isPropertyAccessExpression(parent) || !['dirname', 'url'].includes(parent.name.text)) {
      return ['unknown'];
    }
    return follow(parent, parent.name.text === 'url' ? '__self__' : '.', []);
  });
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

describe('a file whose reads this check cannot bound', () => {
  it.each(READS)('$file is still one, and its inputs cover each target', (entry) => {
    const [top = '', dir = '', ...rest] = entry.file.split('/');
    const source = readFileSync(path.join(REPO_ROOT, entry.file), 'utf8');
    expect(escapesPackage(source, rest.join('/'))).toBe(true);
    const inputs = testInputs(`${top}/${dir}`);
    expect(entry.targets.filter((t) => !isCovered(t, `${top}/${dir}`, inputs))).toEqual([]);
  });

  it.each(ENTRY_POINTS)('%s exists and no file under test imports it', async (entry) => {
    expect(existsSync(path.join(REPO_ROOT, entry))).toBe(true);
    const packageDir = entry.split('/').slice(0, 2).join('/');
    const module = path.posix.basename(entry, '.ts');
    for await (const file of glob(`${packageDir}/{src,tests}/**/*.ts`, { cwd: REPO_ROOT })) {
      const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
      expect(source, file).not.toMatch(new RegExp(`from '[#.]/[^']*${module}(\\.ts)?'`, 'u'));
    }
  });

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
