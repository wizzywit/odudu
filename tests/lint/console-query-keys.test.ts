import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A hand-typed cache key drifts from the function that builds it elsewhere, so
// an invalidation misses it silently. Keys come from a queryKeys.ts, shared or
// its owner's. Found in non-test source: an array literal in a key position
// (`queryKey`, `mutationKey`, a call's `key`, the first argument of a cache
// call, `read` or `invalidate`), direct or via a same-file variable, ternary or
// function; a `*Key` function returning an array outside a queryKeys; any reach
// for `invalidateQueries`; an array opening with a produced kind and a
// non-literal. Not seen: a key built by a function not named `*Key`, or passed in.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE = 'apps/admin-console';
const FIXTURES = 'tests/lint/fixtures/console-query-keys';
const SHARED_KEYS_FILE = 'src/shared/lib/repository/queryKeys.ts';
const OWNER_KEYS_FILE = /^src\/(?:entities|features|pages)\/[^/]+\/repository\/queryKeys\.ts$/u;
const INVALIDATORS = new Set([
  'src/shared/lib/repository/useInvalidate.ts',
  'src/shared/lib/repository/useAfterChange.ts',
]);
const KEY_PROPERTIES = new Set(['queryKey', 'mutationKey']);
const KEY_CALLS = new Set([
  'useRead',
  'useRecord',
  'useResourceList',
  'useQueries',
  'read',
  'invalidate',
  'invalidateExact',
  'invalidateQueries',
  'refetchQueries',
  'setQueryData',
  'getQueryData',
  'removeQueries',
  'resetQueries',
  'cancelQueries',
]);
const PROBE = '\u0000probe';

function isKeysFile(file: string): boolean {
  return file === SHARED_KEYS_FILE || OWNER_KEYS_FILE.test(file);
}

// The kinds a `queryKeys.ts` produces, each with the function that builds it.
export async function kindsOf(file: string): Promise<Map<string, string>> {
  const loaded: unknown = await import(file);
  const kinds = new Map<string, string>();
  if (typeof loaded !== 'object' || loaded === null) return kinds;
  for (const [name, member] of Object.entries(loaded)) {
    if (typeof member !== 'function' || !name.endsWith('Key')) continue;
    const key: unknown = (member as (...probes: string[]) => unknown)(PROBE, PROBE, PROBE);
    const kind: unknown = Array.isArray(key) ? key[0] : undefined;
    if (typeof kind === 'string' && /^[a-z][a-z-]*$/u.test(kind)) kinds.set(kind, name);
  }
  return kinds;
}

function unwrapped(node: ts.Expression): ts.Expression {
  let at = node;
  while (
    ts.isAsExpression(at) ||
    ts.isSatisfiesExpression(at) ||
    ts.isParenthesizedExpression(at) ||
    ts.isNonNullExpression(at) ||
    ts.isTypeAssertionExpression(at)
  ) {
    at = at.expression;
  }
  return at;
}

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
    ? callee.argumentExpression.text
    : null;
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
}

// The expressions a key position may hold: the value itself, or either branch
// of a ternary or fallback in it.
function candidates(expression: ts.Expression): ts.Expression[] {
  const value = unwrapped(expression);
  if (ts.isConditionalExpression(value)) {
    return [...candidates(value.whenTrue), ...candidates(value.whenFalse)];
  }
  if (ts.isBinaryExpression(value)) {
    return [...candidates(value.left), ...candidates(value.right)];
  }
  return [value];
}

// The expressions sitting in a key position of `node`, if it is one.
function keyPositions(node: ts.Node): ts.Expression[] {
  if (ts.isPropertyAssignment(node)) {
    const name = propertyName(node.name);
    if (name !== null && KEY_PROPERTIES.has(name)) return candidates(node.initializer);
    const argument = node.parent.parent;
    if (name === 'key' && ts.isCallExpression(argument)) return candidates(node.initializer);
  }
  if (ts.isShorthandPropertyAssignment(node) && KEY_PROPERTIES.has(node.name.text)) {
    return [node.name];
  }
  if (ts.isCallExpression(node)) {
    const name = calleeName(node);
    const first = node.arguments[0];
    if (name !== null && KEY_CALLS.has(name) && first !== undefined) return candidates(first);
  }
  return [];
}

function declares(scope: ts.Node, name: string): ts.VariableDeclaration | null {
  const statements = ts.isBlock(scope) || ts.isSourceFile(scope) ? scope.statements : [];
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
    }
  }
  return null;
}

// What an identifier was initialised with in the nearest enclosing scope that
// declares it; null for a parameter or an import, which are checked elsewhere.
function initialiserOf(identifier: ts.Identifier): ts.Expression | null {
  for (let at: ts.Node = identifier.parent; ; at = at.parent) {
    if (ts.isFunctionLike(at)) {
      const parameter = at.parameters.some(
        (each) => ts.isIdentifier(each.name) && each.name.text === identifier.text,
      );
      if (parameter) return null;
    }
    const found = declares(at, identifier.text);
    if (found !== null) return found.initializer ?? null;
    if (ts.isSourceFile(at)) return null;
  }
}

function localFunction(file: ts.SourceFile, name: string): ts.Node | null {
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    const found = ts.isVariableStatement(statement) ? declares(file, name) : null;
    if (found?.initializer !== undefined && ts.isArrowFunction(found.initializer)) {
      return found.initializer;
    }
  }
  return null;
}

function returnsArray(fn: ts.Node): boolean {
  const body = ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) ? fn.body : undefined;
  if (body === undefined) return false;
  if (!ts.isBlock(body)) return ts.isArrayLiteralExpression(unwrapped(body));
  return body.statements.some(
    (statement) =>
      ts.isReturnStatement(statement) &&
      statement.expression !== undefined &&
      ts.isArrayLiteralExpression(unwrapped(statement.expression)),
  );
}

// A key spread from a factory's result is built by it, not typed.
// A function named `*Key` that returns an array literal: a key factory.
function isKeyFunction(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node)) {
    return node.name?.text.endsWith('Key') === true && returnsArray(node);
  }
  return (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text.endsWith('Key') &&
    node.initializer !== undefined &&
    returnsArray(node.initializer)
  );
}

function derived(array: ts.ArrayLiteralExpression): boolean {
  const first = array.elements[0];
  return first !== undefined && ts.isSpreadElement(first);
}

function isScanned(file: string): boolean {
  return (
    /\.[cm]?tsx?$/u.test(file) &&
    !/\.test\.[cm]?tsx?$/u.test(file) &&
    !file.endsWith('.d.ts') &&
    !file.startsWith('src/testing/') &&
    !isKeysFile(file)
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

// `files` maps a path relative to the console root to its text; `kinds` maps
// each kind literal to the function that builds it.
export function violations(files: Map<string, string>, kinds: Map<string, string>): string[] {
  const found = new Set<string>();
  for (const [file, text] of files) {
    if (!isScanned(file)) continue;
    const tree = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const report = (node: ts.Node, what: string): void => {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart());
      found.add(`${file}:${String(line + 1)}: ${what}`);
    };
    const openings: ts.ArrayLiteralExpression[] = [];
    const handled = new Set<ts.Node>();
    const handTyped = (array: ts.ArrayLiteralExpression, held: boolean): void => {
      if (derived(array)) return;
      handled.add(array);
      const first = array.elements[0];
      const kind = first !== undefined && ts.isStringLiteralLike(first) ? first.text : null;
      const builder = kind === null ? undefined : kinds.get(kind);
      const where = held ? 'held in a variable' : 'typed in place';
      report(
        array,
        builder === undefined
          ? `a hand-typed query key, ${where}; add a function for it to a queryKeys.ts`
          : `a hand-typed query key, ${where}; build it with ${builder} from queryKeys.ts`,
      );
    };
    const visit = (node: ts.Node): void => {
      for (const position of keyPositions(node)) {
        if (ts.isArrayLiteralExpression(position)) {
          handTyped(position, false);
        } else if (ts.isIdentifier(position)) {
          const init = initialiserOf(position);
          const value = init === null ? null : unwrapped(init);
          if (value !== null && ts.isArrayLiteralExpression(value)) handTyped(value, true);
          if (value && ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
            const local = localFunction(tree, value.expression.text);
            if (local !== null && returnsArray(local)) {
              report(
                position,
                'a query key built by a function of this file; move it to queryKeys',
              );
            }
          }
        } else if (ts.isCallExpression(position) && ts.isIdentifier(position.expression)) {
          const local = localFunction(tree, position.expression.text);
          if (local !== null && returnsArray(local)) {
            report(position, 'a query key built by a function of this file; move it to queryKeys');
          }
        }
      }
      if (ts.isArrayLiteralExpression(node)) openings.push(node);
      if (isKeyFunction(node)) {
        report(node, 'a key function outside a queryKeys.ts; move it there');
      }
      const name =
        ts.isIdentifier(node) && node.text === 'invalidateQueries'
          ? node.text
          : ts.isStringLiteralLike(node) && node.text === 'invalidateQueries'
            ? node.text
            : null;
      if (name !== null && !INVALIDATORS.has(file)) {
        report(node, 'invalidateQueries reached directly; use useInvalidate or useAfterChange');
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const node of openings) {
      const first = node.elements[0];
      const kind = first !== undefined && ts.isStringLiteralLike(first) ? first.text : null;
      const builder = kind === null ? undefined : kinds.get(kind);
      const computed = node.elements.some((element) => !ts.isStringLiteralLike(element));
      if (builder !== undefined && computed && !derived(node) && !handled.has(node)) {
        report(node, `an array starting with '${kind ?? ''}', which ${builder} builds`);
      }
    }
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

const FIXTURE_KINDS = new Map([
  ['list', 'listKey'],
  ['record', 'recordKey'],
]);

describe('console cache keys', { timeout: 60_000 }, () => {
  it('are built by queryKeys, and invalidated through its wrappers', async () => {
    const files = await read(CONSOLE);
    const kinds = new Map<string, string>();
    for (const file of files.keys()) {
      if (!isKeysFile(file)) continue;
      for (const [kind, builder] of await kindsOf(path.join(REPO_ROOT, CONSOLE, file))) {
        kinds.set(kind, builder);
      }
    }
    expect(kinds.get('list')).toBe('listKey');
    expect(kinds.get('record')).toBe('recordKey');
    expect(kinds.get('held-capabilities')).toBe('heldCapabilitiesKey');
    expect(kinds.get('evaluate')).toBe('evaluateKey');
    expect(kinds.has('system-issuer')).toBe(true);
    expect(kinds.get('scope-clients')).toBe('scopeClientsKey');
    expect(kinds.get('session')).toBe('sessionKey');
    expect([...files.keys()]).toContain('src/shared/lib/repository/useInvalidate.ts');
    expect(violations(files, kinds)).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass`);
    expect(files.size).toBeGreaterThan(3);
    expect(violations(files, FIXTURE_KINDS)).toEqual([]);
  });

  it('fail every non-conforming fixture, naming the file and the line', async () => {
    const files = await read(`${FIXTURES}/fail`);
    expect(files.size).toBeGreaterThan(3);
    const keys = 'add a function for it to a queryKeys.ts';
    const R = 'src/features/roles/repository';
    const typed = (how: string, rest: string): string => `a hand-typed query key, ${how}; ${rest}`;
    expect(violations(files, FIXTURE_KINDS)).toEqual([
      `${R}/privateKey.ts:1: a key function outside a queryKeys.ts; move it there`,
      `${R}/privateKey.ts:5: a key function outside a queryKeys.ts; move it there`,
      `${R}/useAfter.ts:6: an array starting with 'list', which listKey builds`,
      `${R}/useAfter.ts:7: invalidateQueries reached directly; use useInvalidate or useAfterChange`,
      `${R}/useDestructured.ts:4: invalidateQueries reached directly; use useInvalidate or useAfterChange`,
      `${R}/useDestructured.ts:5: invalidateQueries reached directly; use useInvalidate or useAfterChange`,
      `${R}/useDestructured.ts:6: invalidateQueries reached directly; use useInvalidate or useAfterChange`,
      `${R}/useFresh.ts:8: ${typed('typed in place', keys)}`,
      `${R}/useFresh.ts:9: ${typed('typed in place', 'build it with listKey from queryKeys.ts')}`,
      `${R}/useFresh.ts:10: ${typed('typed in place', keys)}`,
      `${R}/useFresh.ts:11: ${typed('typed in place', keys)}`,
      `${R}/useIdentifier.ts:4: a key function outside a queryKeys.ts; move it there`,
      `${R}/useIdentifier.ts:15: ${typed('held in a variable', keys)}`,
      `${R}/useIdentifier.ts:16: ${typed('held in a variable', keys)}`,
      `${R}/useIdentifier.ts:17: ${typed('held in a variable', keys)}`,
      `${R}/useIdentifier.ts:20: ${typed('typed in place', keys)}`,
      `${R}/useIdentifier.ts:21: a query key built by a function of this file; move it to queryKeys`,
      `${R}/useIdentifier.ts:22: a query key built by a function of this file; move it to queryKeys`,
      `${R}/useKeys.ts:6: ${typed('typed in place', 'build it with listKey from queryKeys.ts')}`,
      `${R}/useKeys.ts:7: ${typed('typed in place', keys)}`,
      `${R}/useKeys.ts:8: ${typed('typed in place', 'build it with recordKey from queryKeys.ts')}`,
      `${R}/useKeys.ts:9: ${typed('typed in place', keys)}`,
      `${R}/useKeys.ts:10: ${typed('typed in place', keys)}`,
      `${R}/useReads.ts:4: ${typed('typed in place', 'build it with recordKey from queryKeys.ts')}`,
    ]);
  });
});
