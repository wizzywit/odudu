import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Each package's `test` task is cached on that package's own files (turbo.json).
// A file that builds a path climbing above its package root reads something
// the cache key does not cover, so a change there would replay a stale pass —
// unless the package has a `<name>#test` override whose `$TURBO_ROOT$/…`
// inputs name the files the climb actually reaches.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PATH_BUILDERS = new Set(['join', 'resolve']);
const TURBO_ROOT_PREFIX = '$TURBO_ROOT$/';

// Normalised first: a literal like 'fixtures/../../../shared/../../../../a'
// does not start with '..', but resolves to five levels above its own
// directory, and a plain leading-segment count would miss that entirely.
function leadingParentSegments(text: string): number {
  let count = 0;
  for (const segment of path.posix.normalize(text).split('/')) {
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

// The pure part: whether a resolved read target is named by one of a
// package's own `$TURBO_ROOT$/…` test inputs. `target` and the input globs
// are both repo-relative POSIX paths with no leading slash.
export function isCoveredByTurboInputs(
  target: string,
  isDirectory: boolean,
  inputs: readonly string[],
): boolean {
  const globs = inputs
    .filter((input) => input.startsWith(TURBO_ROOT_PREFIX))
    .map((input) => input.slice(TURBO_ROOT_PREFIX.length));
  return globs.some((glob) => {
    if (path.matchesGlob(target, glob)) return true;
    // A directory has no file of its own to match a `/**` glob directly;
    // it is covered when something one level under it would be.
    return isDirectory && path.matchesGlob(path.posix.join(target, '__probe__'), glob);
  });
}

function turboRootInputs(): Map<string, string[]> {
  const turbo: unknown = JSON.parse(readFileSync(path.join(REPO_ROOT, 'turbo.json'), 'utf8'));
  const tasks = (turbo as { tasks?: Record<string, { inputs?: unknown }> }).tasks ?? {};
  const byPackage = new Map<string, string[]>();
  for (const [id, task] of Object.entries(tasks)) {
    if (!id.endsWith('#test') || !Array.isArray(task.inputs)) continue;
    const inputs = task.inputs.filter(
      (i): i is string => typeof i === 'string' && i.startsWith(TURBO_ROOT_PREFIX),
    );
    if (inputs.length > 0) byPackage.set(id.slice(0, -'#test'.length), inputs);
  }
  return byPackage;
}

function packageName(packageDir: string): string {
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(REPO_ROOT, packageDir, 'package.json'), 'utf8'),
  );
  const name: unknown = (manifest as { name?: unknown }).name;
  if (typeof name !== 'string') throw new Error(`${packageDir}/package.json has no name`);
  return name;
}

// --- Resolving what an escaping call actually reads ---
//
// A call that climbs above its package is usually assigned to a constant
// used as the base of further `join`/`resolve` calls elsewhere in the same
// file (`REPO_ROOT`, then `PACKAGES_DIR = join(REPO_ROOT, 'packages')`, and
// so on), so the read a package's turbo inputs must cover is not the climb
// itself but wherever that chain of assignments terminates.

function isImportMetaProperty(node: ts.Node, prop: string): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.name.text === prop
  );
}

function rootIdentifierName(expr: ts.Expression): string | undefined {
  let current: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(current)) current = current.expression;
  return ts.isIdentifier(current) ? current.text : undefined;
}

// `ts.Node.parent` is typed as always present, but the root `SourceFile`
// genuinely has none at runtime — this narrows it back to optional so a
// walk to the root can be told apart from one that never ends.
function nodeParent(node: ts.Node): ts.Node | undefined {
  return (node as { parent?: ts.Node }).parent;
}

// A segment built from a `for…of` loop variable stands for whichever
// directory entry the loop is enumerating — the same thing a turbo glob's
// `*` stands for — so it resolves to `*` rather than failing closed.
function isBoundByEnclosingForOf(node: ts.Node, name: string): boolean {
  for (
    let current: ts.Node | undefined = node;
    current !== undefined;
    current = nodeParent(current)
  ) {
    if (ts.isForOfStatement(current) && ts.isVariableDeclarationList(current.initializer)) {
      for (const decl of current.initializer.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) return true;
      }
    }
  }
  return false;
}

interface FileResolver {
  /** Resolves an expression to a repo-relative POSIX directory or file path. */
  resolveExpr(expr: ts.Expression, visiting?: Set<string>): string | undefined;
  /** Every qualifying call using `name` as its base argument. */
  forwardUsages(name: string): ts.CallExpression[];
  /** The constant name a call expression was assigned to, if any. */
  assignedName(call: ts.CallExpression | ts.NewExpression): string | undefined;
}

function buildResolver(sourceFile: ts.SourceFile, fileDir: string): FileResolver {
  const consts = new Map<string, ts.Expression>();
  const nameByInit = new Map<ts.Expression, string>();
  const visitDecls = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      consts.set(node.name.text, node.initializer);
      nameByInit.set(node.initializer, node.name.text);
    }
    ts.forEachChild(node, visitDecls);
  };
  visitDecls(sourceFile);

  function resolveSegment(arg: ts.Expression, enclosing: ts.Node): string | undefined {
    if (ts.isStringLiteralLike(arg)) return arg.text;
    const root = rootIdentifierName(arg);
    if (root !== undefined && isBoundByEnclosingForOf(enclosing, root)) return '*';
    return undefined;
  }

  function resolveExpr(expr: ts.Expression, visiting = new Set<string>()): string | undefined {
    if (ts.isStringLiteralLike(expr)) return expr.text;
    if (isImportMetaProperty(expr, 'dirname') || isImportMetaProperty(expr, 'url')) return fileDir;
    if (ts.isIdentifier(expr)) {
      if (visiting.has(expr.text)) return undefined;
      const init = consts.get(expr.text);
      if (!init) return undefined;
      visiting.add(expr.text);
      const resolved = resolveExpr(init, visiting);
      visiting.delete(expr.text);
      return resolved;
    }
    if (ts.isCallExpression(expr)) {
      const name = calleeName(expr);
      // A URL-to-path (or back) conversion does not change which directory
      // is meant, so it passes its argument straight through.
      if (name === 'fileURLToPath' || name === 'pathToFileURL') {
        const [arg] = expr.arguments;
        return arg ? resolveExpr(arg, visiting) : undefined;
      }
      if (name !== undefined && PATH_BUILDERS.has(name)) {
        const [baseArg, ...rest] = expr.arguments;
        if (baseArg === undefined) return undefined;
        const base = resolveExpr(baseArg, visiting);
        if (base === undefined) return undefined;
        const segments: string[] = [];
        for (const arg of rest) {
          const segment = resolveSegment(arg, expr);
          if (segment === undefined) return undefined;
          segments.push(segment);
        }
        return path.posix.normalize(path.posix.join(base, ...segments));
      }
      return undefined;
    }
    if (ts.isNewExpression(expr) && calleeName(expr) === 'URL') {
      const args = expr.arguments ?? [];
      const [literalArg, baseArg] = args;
      if (!literalArg) return undefined;
      const segment = resolveSegment(literalArg, expr);
      const base = baseArg ? resolveExpr(baseArg, visiting) : fileDir;
      if (segment === undefined || base === undefined) return undefined;
      return path.posix.normalize(path.posix.join(base, segment));
    }
    return undefined;
  }

  function forwardUsages(name: string): ts.CallExpression[] {
    const found: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callName = calleeName(node);
        if (callName !== undefined && PATH_BUILDERS.has(callName)) {
          const [first] = node.arguments;
          if (first && ts.isIdentifier(first) && first.text === name) found.push(node);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  }

  // `fileURLToPath`/`pathToFileURL` wrap a call without changing which
  // directory is meant, so a declaration assigned from the wrapped form
  // (`const REPO_ROOT = fileURLToPath(new URL(...))`) still counts as
  // assigned from the call inside it.
  function outermostWrapper(node: ts.Expression): ts.Expression {
    let current = node;
    for (;;) {
      const parent = nodeParent(current);
      if (
        parent === undefined ||
        !ts.isCallExpression(parent) ||
        parent.arguments.length !== 1 ||
        parent.arguments[0] !== current ||
        (calleeName(parent) !== 'fileURLToPath' && calleeName(parent) !== 'pathToFileURL')
      ) {
        return current;
      }
      current = parent;
    }
  }

  return {
    resolveExpr,
    forwardUsages,
    assignedName: (call) => nameByInit.get(outermostWrapper(call)),
  };
}

interface Terminal {
  target: string | undefined;
}

// Follows a constant forward through every place it is used as the base of
// another qualifying call, as far as that chain of assignments goes, and
// reports the target(s) it bottoms out at. A step whose extra arguments
// cannot be resolved reports as unresolved rather than guessing.
function terminalTargets(
  resolver: FileResolver,
  name: string,
  seen = new Set<string>(),
): Terminal[] {
  if (seen.has(name)) return [{ target: undefined }];
  seen.add(name);
  const usages = resolver.forwardUsages(name);
  if (usages.length === 0) {
    // No further use as a base: `name`'s own resolved value is the target.
    const target = resolver.resolveExpr(ts.factory.createIdentifier(name));
    return [{ target }];
  }
  const results: Terminal[] = [];
  for (const usage of usages) {
    const forwardName = resolver.assignedName(usage);
    if (forwardName !== undefined) {
      results.push(...terminalTargets(resolver, forwardName, seen));
      continue;
    }
    results.push({ target: resolver.resolveExpr(usage) });
  }
  return results;
}

function isLiteralDirectoryLike(target: string): boolean {
  // A resolved target with no file extension segment reads as a directory
  // for the purpose of the "covered beneath" rule; a wildcard-terminated
  // one (an enumerated entry) could be either, so both are tried.
  return !path.posix.basename(target).includes('.');
}

interface Offense {
  file: string;
  message: string;
}

function checkFile(
  file: string,
  packageDir: string,
  fileWithinPackage: string,
  source: string,
  inputsByPackage: Map<string, string[]>,
): Offense | undefined {
  const depth = path.posix
    .dirname(fileWithinPackage)
    .split('/')
    .filter((s) => s !== '.').length;
  const fileDir = path.posix.join(packageDir, path.posix.dirname(fileWithinPackage));
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const resolver = buildResolver(sourceFile, fileDir);

  const escapingCalls: (ts.CallExpression | ts.NewExpression)[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = calleeName(node);
      if (name !== undefined && (PATH_BUILDERS.has(name) || name === 'URL')) {
        let climb = 0;
        for (const arg of node.arguments ?? []) {
          if (ts.isStringLiteralLike(arg)) climb += leadingParentSegments(arg.text);
        }
        if (climb > depth) escapingCalls.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (escapingCalls.length === 0) return undefined;

  const name = packageName(packageDir);
  const inputs = inputsByPackage.get(name) ?? [];

  const terminals: Terminal[] = [];
  for (const call of escapingCalls) {
    const assigned = resolver.assignedName(call);
    if (assigned !== undefined) {
      terminals.push(...terminalTargets(resolver, assigned));
    } else {
      terminals.push({ target: resolver.resolveExpr(call) });
    }
  }

  const uncovered = terminals.filter((terminal) => {
    if (terminal.target === undefined) return true;
    const covered =
      isCoveredByTurboInputs(terminal.target, false, inputs) ||
      (isLiteralDirectoryLike(terminal.target) &&
        isCoveredByTurboInputs(terminal.target, true, inputs));
    return !covered;
  });
  if (uncovered.length === 0) return undefined;

  const targets = uncovered.map((t) => t.target ?? '<unresolved>').join(', ');
  return {
    file,
    message:
      `${file} builds a path above ${packageDir}, reaching ${targets}; add a "${name}#test" ` +
      `task to turbo.json that copies the generic "test" task and adds the files it reads as ` +
      `"$TURBO_ROOT$/…" inputs (current: ${inputs.join(', ') || 'none'})`,
  };
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

  it('normalises a literal before counting its climb, catching segments a cancelled prefix hides', () => {
    expect(
      deepestClimb("join(import.meta.dirname, 'fixtures/../../../shared/../../../../a');"),
    ).toBe(5);
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

  it('flags a climb a cancelled-looking literal hides', () => {
    expect(
      escapesPackage(
        "join(import.meta.dirname, 'fixtures/../../../shared/../../../../a')",
        'src/view/x.test.ts',
      ),
    ).toBe(true);
  });

  it('does not flag a literal that climbs and returns inside the package', () => {
    expect(
      escapesPackage("join(import.meta.dirname, '../../fixtures/..')", 'src/view/x.test.ts'),
    ).toBe(false);
  });
});

describe('isCoveredByTurboInputs', () => {
  it('covers a file a glob names directly', () => {
    expect(
      isCoveredByTurboInputs('packages/db/src/schema/tenants.ts', false, [
        '$TURBO_ROOT$/packages/*/src/schema/**',
      ]),
    ).toBe(true);
  });

  it('covers a directory when the glob covers files beneath it', () => {
    expect(
      isCoveredByTurboInputs('packages/db/src/schema', true, [
        '$TURBO_ROOT$/packages/*/src/schema/**',
      ]),
    ).toBe(true);
  });

  it('reports an uncovered target even in a package with other root inputs', () => {
    expect(
      isCoveredByTurboInputs('packages/db/src/other', false, [
        '$TURBO_ROOT$/packages/*/src/schema/**',
      ]),
    ).toBe(false);
  });

  it('covers nothing for a package with no overrides', () => {
    expect(isCoveredByTurboInputs('packages/db/src/schema/tenants.ts', false, [])).toBe(false);
  });
});

describe(
  'a file that reads above its package root has a turbo.json test override that covers it',
  { timeout: 60_000 },
  () => {
    it('holds for every package, app and tool', async () => {
      const inputsByPackage = turboRootInputs();
      const offenders: string[] = [];
      let scanned = 0;
      for await (const file of glob('{packages,apps,tools}/*/{src,tests}/**/*.ts', {
        cwd: REPO_ROOT,
      })) {
        scanned += 1;
        const [top = '', dir = '', ...rest] = file.split(path.sep);
        const packageDir = `${top}/${dir}`;
        const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
        const offense = checkFile(file, packageDir, rest.join('/'), source, inputsByPackage);
        if (offense) offenders.push(offense.message);
      }
      expect(scanned).toBeGreaterThan(100);
      expect(offenders).toEqual([]);
    });
  },
);
