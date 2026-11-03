import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A hook or component takes a store's actions through a selector, so the
// dependency is visible and the action is a stable reference. In non-test
// source this finds an action called through `.getState()` (also by computed
// key, alias or destructuring) inside a `use*` function, a PascalCase
// component, `forwardRef` or `memo` wrapper, anonymous default export or class
// method; `S.setState(…)` anywhere; `useS()` or `useS((s) => s)`. Data reads and
// module functions are allowed. A store comes from zustand's `create`,
// `createStore` or `createWithEqualityFn`. Not seen: a store held in a local.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE = 'apps/admin-console';
const FIXTURES = 'tests/lint/fixtures/console-store-access';

interface Source {
  file: string;
  tree: ts.SourceFile;
}

function isHookOrComponent(name: string): boolean {
  return /^use[A-Z0-9]/u.test(name) || /^[A-Z]/u.test(name) || name === 'default';
}

type FunctionNode =
  ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function hasDefault(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((each) => each.kind === ts.SyntaxKind.DefaultKeyword)
  );
}

// The name a function is known by: its own, its variable's (also through a
// `forwardRef(…)` or `memo(…)` call), its class's for a method, or `default`.
function nameOf(fn: FunctionNode): string | null {
  if (ts.isMethodDeclaration(fn)) {
    return ts.isClassLike(fn.parent) ? (fn.parent.name?.text ?? null) : null;
  }
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text ?? (hasDefault(fn) ? 'default' : null);
  if (fn.name !== undefined && ts.isFunctionExpression(fn)) return fn.name.text;
  let at: ts.Node = fn.parent;
  if (ts.isCallExpression(at)) at = at.parent;
  if (ts.isExportAssignment(at)) return 'default';
  return ts.isVariableDeclaration(at) && ts.isIdentifier(at.name) ? at.name.text : null;
}

// The hook or component a node sits in, however deeply nested.
function enclosing(node: ts.Node): string | null {
  for (let at: ts.Node = node.parent; !ts.isSourceFile(at); at = at.parent) {
    if (isFunctionNode(at)) {
      const name = nameOf(at);
      if (name !== null && isHookOrComponent(name)) return name;
    }
  }
  return null;
}

function leftmostCallee(node: ts.Expression): ts.Expression {
  let at = node;
  while (ts.isCallExpression(at)) at = at.expression;
  return at;
}

const MAKERS = new Set(['create', 'createStore', 'createWithEqualityFn']);

function importedNames(
  tree: ts.SourceFile,
  from: (module: string) => boolean,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    if (!from(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        names.set(element.name.text, (element.propertyName ?? element.name).text);
      }
    }
    if (statement.importClause?.name !== undefined) {
      names.set(statement.importClause.name.text, 'default');
    }
  }
  return names;
}

function storesOf(source: Source): string[] {
  const makers = [...importedNames(source.tree, (module) => module.startsWith('zustand'))]
    .filter(([, imported]) => MAKERS.has(imported))
    .map(([local]) => local);
  const stores: string[] = [];
  for (const statement of source.tree.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (ts.isIdentifier(declaration.name) && init !== undefined && ts.isCallExpression(init)) {
        const callee = leftmostCallee(init);
        if (ts.isIdentifier(callee) && makers.includes(callee.text)) {
          stores.push(declaration.name.text);
        }
      }
    }
  }
  return stores;
}

function memberName(callee: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
    return callee.argumentExpression.text;
  }
  return null;
}

function storeOf(callee: ts.Expression, mine: ReadonlySet<string>, member: string): string | null {
  if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return null;
  const receiver = callee.expression;
  return memberName(callee) === member && ts.isIdentifier(receiver) && mine.has(receiver.text)
    ? receiver.text
    : null;
}

// `S.getState()` for a store S.
function isStateRead(node: ts.Node, mine: ReadonlySet<string>): node is ts.CallExpression {
  return ts.isCallExpression(node) && storeOf(node.expression, mine, 'getState') !== null;
}

function chainStart(node: ts.Expression): ts.Expression {
  let at = node;
  while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) at = at.expression;
  return at;
}

function lineOf(tree: ts.SourceFile, node: ts.Node): number {
  return tree.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

// What a hook or component takes out of a store's state: the whole state under
// a name (`whole`, whose members are called as `s.push()`), or single members
// copied out of it (`parts`, called as `push()`).
function takenFromState(
  scope: ts.Node,
  mine: ReadonlySet<string>,
): { whole: Set<string>; parts: Set<string> } {
  const whole = new Set<string>();
  const parts = new Set<string>();
  for (let again = true; again;) {
    again = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        const init = node.initializer;
        const root = chainStart(init);
        const fromState = isStateRead(init, mine);
        const viaState = isStateRead(root, mine) && root !== init;
        const fromWhole = ts.isIdentifier(root) && whole.has(root.text);
        const add = (name: string, into: Set<string>): void => {
          if (!whole.has(name) && !parts.has(name)) {
            into.add(name);
            again = true;
          }
        };
        if (ts.isIdentifier(node.name)) {
          if (fromState || (fromWhole && root === init)) add(node.name.text, whole);
          else if (viaState || fromWhole) add(node.name.text, parts);
        } else if (ts.isObjectBindingPattern(node.name) && (fromState || fromWhole || viaState)) {
          for (const element of node.name.elements) {
            if (ts.isIdentifier(element.name)) add(element.name.text, parts);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(scope);
  }
  return { whole, parts };
}

function isScanned(file: string): boolean {
  return (
    /\.[cm]?tsx?$/u.test(file) &&
    !/\.test\.[cm]?tsx?$/u.test(file) &&
    !file.endsWith('.d.ts') &&
    !file.startsWith('src/testing/')
  );
}

function byPlace(a: string, b: string): number {
  const place = (text: string): [string, number] => {
    const [file = '', line = '0'] = text.split(':', 2);
    return [file, Number(line)];
  };
  const [fileA, lineA] = place(a);
  const [fileB, lineB] = place(b);
  return fileA.localeCompare(fileB) || lineA - lineB || a.localeCompare(b);
}

// A selector that returns the whole state, which re-renders on every change.
function isIdentitySelector(argument: ts.Expression | undefined): boolean {
  if (argument === undefined || !ts.isArrowFunction(argument)) return false;
  const [parameter] = argument.parameters;
  return (
    parameter !== undefined &&
    ts.isIdentifier(parameter.name) &&
    ts.isIdentifier(argument.body) &&
    argument.body.text === parameter.name.text
  );
}

// `files` maps a path relative to the console root to its text.
export function violations(files: Map<string, string>): string[] {
  const sources: Source[] = [...files]
    .filter(([file]) => isScanned(file))
    .map(([file, text]) => ({
      file,
      tree: ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    }));
  const stores = new Set(sources.flatMap((source) => storesOf(source)));
  const found = new Set<string>();
  for (const source of sources) {
    const { file, tree } = source;
    const mine = new Set<string>(storesOf(source));
    for (const [local, imported] of importedNames(tree, () => true)) {
      if (stores.has(imported) || (imported === 'default' && stores.has(local))) mine.add(local);
    }
    const report = (node: ts.Node, what: string): void => {
      found.add(`${file}:${String(lineOf(tree, node))}: ${what}`);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const target = storeOf(callee, mine, 'setState');
        if (target !== null) {
          report(node, `${target}.setState changes the store outside its actions`);
        }
        if (ts.isIdentifier(callee) && mine.has(callee.text)) {
          if (node.arguments.length === 0 || isIdentitySelector(node.arguments[0])) {
            report(node, `${callee.text}() subscribes to the whole store; pass a selector`);
          }
        }
        const host = enclosing(node);
        if (
          host !== null &&
          (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee))
        ) {
          if (isStateRead(chainStart(callee.expression), mine)) {
            report(node, `${host} calls a store action through getState; select it instead`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    const lookInto = (node: ts.Node): void => {
      if (isFunctionNode(node)) {
        const name = nameOf(node);
        if (name !== null && isHookOrComponent(name) && node.body !== undefined) {
          const taken = takenFromState(node.body, mine);
          const calls = (inner: ts.Node): void => {
            if (ts.isCallExpression(inner)) {
              const callee = inner.expression;
              const direct =
                ts.isIdentifier(callee) &&
                (taken.parts.has(callee.text) || taken.whole.has(callee.text));
              const member =
                (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
                ts.isIdentifier(callee.expression) &&
                taken.whole.has(callee.expression.text);
              if (direct || member) {
                report(inner, `${name} calls a store action through getState; select it instead`);
              }
            }
            ts.forEachChild(inner, calls);
          };
          calls(node.body);
        }
      }
      ts.forEachChild(node, lookInto);
    };
    lookInto(tree);
  }
  return [...found].sort(byPlace);
}

async function read(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob('src/**/*.{ts,tsx,mts,cts}', { cwd: path.join(REPO_ROOT, root) })) {
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, root, file), 'utf8'));
  }
  return files;
}

describe('console source', { timeout: 60_000 }, () => {
  it('reaches stores through selectors, tests and testing/ excepted', async () => {
    const files = await read(CONSOLE);
    const names = [...files.keys()];
    expect(names).toContain('src/shared/lib/repository/useUnsavedGuard.ts');
    expect(names).toContain('src/app/NavigationGuard/NavigationGuard.tsx');
    expect(violations(files)).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass`);
    expect(files.size).toBeGreaterThan(5);
    expect(violations(files)).toEqual([]);
  });

  it('fail every non-conforming fixture, naming the file and the line', async () => {
    const files = await read(`${FIXTURES}/fail`);
    expect(files.size).toBeGreaterThan(4);
    expect(violations(files)).toEqual([
      'src/app/Anonymous.tsx:4: default calls a store action through getState; select it instead',
      'src/app/Forms.tsx:6: Wrapped calls a store action through getState; select it instead',
      'src/app/Forms.tsx:11: Inner calls a store action through getState; select it instead',
      'src/app/Forms.tsx:19: Aliased calls a store action through getState; select it instead',
      'src/app/Forms.tsx:20: Aliased calls a store action through getState; select it instead',
      'src/app/Forms.tsx:25: useToasts() subscribes to the whole store; pass a selector',
      'src/app/Forms.tsx:26: Toasts() subscribes to the whole store; pass a selector',
      'src/app/Forms.tsx:31: Renamed calls a store action through getState; select it instead',
      'src/app/Forms.tsx:32: useToasts.setState changes the store outside its actions',
      'src/app/Klass.tsx:6: Banner calls a store action through getState; select it instead',
      'src/app/Leave.tsx:6: Leave calls a store action through getState; select it instead',
      'src/app/Leave.tsx:11: useToasts() subscribes to the whole store; pass a selector',
      'src/app/Leave.tsx:16: useDrafts() subscribes to the whole store; pass a selector',
      'src/app/Nested.tsx:7: Nested calls a store action through getState; select it instead',
      'src/app/UsesVanilla.tsx:4: UsesVanilla calls a store action through getState; select it instead',
      'src/features/session/repository/reset.ts:4: useToasts.setState changes the store outside its actions',
      'src/features/session/repository/useSignIn.ts:6: useSignIn calls a store action through getState; select it instead',
      'src/features/session/repository/useSignIn.ts:13: useSignOut calls a store action through getState; select it instead',
    ]);
  });
});
