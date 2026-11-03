import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Module state outlives a test and nothing resets it. Found outside testing/: a
// top-level `let` or `var`; a top-level collection or object mutated here or in
// a file importing it (alias, destructured method, computed key, `.call`); class
// static state and top-level instances whose methods change `this`; a window or
// globalThis assignment; a load-time call, IIFE or `new` of a function whose
// closures keep a counter, collection or setter (a null-started `let` is a memo
// slot only if no assignment reads a factory `let` or a returned input). Not
// seen: namespace-import mutation, factories behind a call, parameter mutation.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE = 'apps/admin-console';
const DOCS = 'apps/docs';
const FIXTURES = 'tests/lint/fixtures/console-no-module-state';
const MUTATORS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'add',
  'set',
  'delete',
  'clear',
]);
const COLLECTIONS = new Set(['Set', 'Map', 'WeakSet', 'WeakMap', 'Array']);
const DEFINERS = new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf']);
const GLOBALS = new Set(['window', 'globalThis', 'self']);
const NAVIGATION = new Set(['location', 'name', 'status']);
const ASSIGNMENTS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);
const PLAIN = new Set([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]);

interface Source {
  file: string;
  tree: ts.SourceFile;
}

interface Candidate {
  name: string;
  file: string;
  line: number;
  object: ts.ObjectLiteralExpression | null;
}

interface Factory {
  name: string;
  file: string;
  holds: string;
  at: number;
}

function unwrap(node: ts.Expression): ts.Expression {
  let at = node;
  while (
    ts.isParenthesizedExpression(at) ||
    ts.isNonNullExpression(at) ||
    ts.isAsExpression(at) ||
    ts.isSatisfiesExpression(at) ||
    ts.isTypeAssertionExpression(at)
  ) {
    at = at.expression;
  }
  return at;
}

function isConstAssertion(node: ts.Expression): boolean {
  let at = node;
  while (ts.isParenthesizedExpression(at) || ts.isSatisfiesExpression(at)) at = at.expression;
  return ts.isAsExpression(at) && ts.isTypeReferenceNode(at.type) && at.type.getText() === 'const';
}

function isMutableValue(init: ts.Expression): boolean {
  if (isConstAssertion(init)) return false;
  const value = unwrap(init);
  if (ts.isArrayLiteralExpression(value) || ts.isObjectLiteralExpression(value)) return true;
  if (ts.isNewExpression(value)) {
    return ts.isIdentifier(value.expression) && COLLECTIONS.has(value.expression.text);
  }
  return (
    ts.isCallExpression(value) &&
    ts.isPropertyAccessExpression(value.expression) &&
    value.expression.expression.getText() === 'Array' &&
    ['from', 'of'].includes(value.expression.name.text)
  );
}

// `x`, `x.a`, `x[k].b`, `(x as T)!.c`, `this.n`: the name a member chain starts from.
function rootOf(node: ts.Expression): string | null {
  let at = node;
  for (;;) {
    if (ts.isIdentifier(at)) return at.text;
    if (at.kind === ts.SyntaxKind.ThisKeyword) return 'this';
    if (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) at = at.expression;
    else if (ts.isParenthesizedExpression(at) || ts.isNonNullExpression(at)) at = at.expression;
    else if (ts.isAsExpression(at) || ts.isTypeAssertionExpression(at)) at = at.expression;
    else return null;
  }
}

function boundNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) out.add(name.text);
  else {
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) boundNames(element.name, out);
    }
  }
}

function declaredIn(scope: ts.Node): Set<string> {
  const names = new Set<string>();
  const statements = ts.isBlock(scope) || ts.isSourceFile(scope) ? scope.statements : [];
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        boundNames(declaration.name, names);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    }
  }
  return names;
}

// Whether `name` at `node` is a binding of something between it and `scope`.
function shadowed(node: ts.Node, name: string, scope: ts.Node): boolean {
  for (let at = node.parent; at !== scope; at = at.parent) {
    if (ts.isFunctionLike(at)) {
      const parameters = new Set<string>();
      for (const parameter of at.parameters) boundNames(parameter.name, parameters);
      if (parameters.has(name)) return true;
    }
    if ((ts.isBlock(at) || ts.isSourceFile(at)) && declaredIn(at).has(name)) return true;
  }
  return false;
}

function lineOf(tree: ts.SourceFile, node: ts.Node): number {
  return tree.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

function memberName(callee: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
    return callee.argumentExpression.text;
  }
  return null;
}

interface Watched {
  names: Set<string>;
  // Local names bound to a mutating method of a watched value.
  methods: Set<string>;
  // Members an object literal defines itself, so calling one is not mutation.
  own: ReadonlySet<string>;
}

// The names that reach a watched value inside `scope`: aliases (`const r = q`)
// and mutating methods taken out of it (`const { set } = q`).
function watching(scope: ts.Node, first: string, object: ts.ObjectLiteralExpression | null) {
  const watched: Watched = {
    names: new Set([first]),
    methods: new Set(),
    own: new Set(
      (object?.properties ?? []).flatMap((property) =>
        property.name !== undefined && ts.isIdentifier(property.name) ? [property.name.text] : [],
      ),
    ),
  };
  for (let again = true; again;) {
    again = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        const source = rootOf(unwrap(node.initializer));
        if (source !== null && watched.names.has(source)) {
          if (ts.isIdentifier(node.name) && !watched.names.has(node.name.text)) {
            watched.names.add(node.name.text);
            again = true;
          } else if (ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
              const key = (element.propertyName ?? element.name).getText();
              if (MUTATORS.has(key) && ts.isIdentifier(element.name)) {
                watched.methods.add(element.name.text);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(scope);
  }
  return watched;
}

function isPattern(node: ts.Expression): boolean {
  return ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node);
}

// Whether a destructuring assignment writes into a member of a watched value.
function targetsReach(pattern: ts.Node, reaches: (node: ts.Expression) => boolean): boolean {
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      reaches(node)
    ) {
      hit = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(pattern);
  return hit;
}

// The line of the first thing inside `scope` that changes a watched value.
function mutationOf(tree: ts.SourceFile, scope: ts.Node, watched: Watched): number | null {
  let found: number | null = null;
  const reaches = (node: ts.Expression): boolean => {
    const root = rootOf(node);
    return root !== null && watched.names.has(root) && !shadowed(node, root, scope);
  };
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = memberName(callee);
      const receiver =
        ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
          ? callee.expression
          : null;
      const viaCall =
        name !== null && ['call', 'apply'].includes(name) && receiver !== null
          ? memberName(receiver)
          : null;
      const first = node.arguments[0];
      if (
        name !== null &&
        MUTATORS.has(name) &&
        receiver !== null &&
        !watched.own.has(name) &&
        reaches(receiver)
      ) {
        found = lineOf(tree, node);
      } else if (
        viaCall !== null &&
        MUTATORS.has(viaCall) &&
        first !== undefined &&
        reaches(first)
      ) {
        found = lineOf(tree, node);
      } else if (
        name !== null &&
        DEFINERS.has(name) &&
        receiver?.getText() === 'Object' &&
        first !== undefined &&
        reaches(first)
      ) {
        found = lineOf(tree, node);
      } else if (
        ts.isIdentifier(callee) &&
        watched.methods.has(callee.text) &&
        !shadowed(callee, callee.text, scope)
      ) {
        found = lineOf(tree, node);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      ASSIGNMENTS.has(node.operatorToken.kind) &&
      !ts.isIdentifier(node.left) &&
      (reaches(node.left) || (isPattern(node.left) && targetsReach(node.left, reaches)))
    ) {
      found = lineOf(tree, node);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      !ts.isIdentifier(node.operand) &&
      reaches(node.operand)
    ) {
      found = lineOf(tree, node);
    } else if (ts.isDeleteExpression(node) && reaches(node.expression)) {
      found = lineOf(tree, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

// The line where an object literal's own method changes `this`.
function selfMutation(tree: ts.SourceFile, object: ts.ObjectLiteralExpression): number | null {
  for (const property of object.properties) {
    if (ts.isMethodDeclaration(property) || ts.isGetAccessor(property)) {
      const line = mutationOf(tree, property, {
        names: new Set(['this']),
        methods: new Set(),
        own: new Set(),
      });
      if (line !== null) return line;
    }
  }
  return null;
}

function isReference(node: ts.Identifier): boolean {
  const { parent } = node;
  if (ts.isPropertyAccessExpression(parent)) return parent.name !== node;
  if (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent))
    return parent.name !== node;
  return !((ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === node);
}

function isWriteTarget(node: ts.Identifier): boolean {
  const { parent } = node;
  return (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    ASSIGNMENTS.has(parent.operatorToken.kind)
  );
}

// A function nested in `scope` that reads or writes `name`.
function capturedIn(scope: ts.Node, name: string): boolean {
  let captured = false;
  const visit = (node: ts.Node, inner: boolean): void => {
    if (captured) return;
    if (inner && ts.isIdentifier(node) && node.text === name && isReference(node)) {
      if (!shadowed(node, name, scope)) captured = true;
      return;
    }
    ts.forEachChild(node, (child) => {
      visit(child, inner || ts.isFunctionLike(child));
    });
  };
  visit(scope, false);
  return captured;
}

function assignmentsOf(scope: ts.Node, name: string): ts.BinaryExpression[] {
  const found: ts.BinaryExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      ASSIGNMENTS.has(node.operatorToken.kind) &&
      ts.isIdentifier(node.left) &&
      node.left.text === name
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

function changesInPlace(scope: ts.Node, name: string): boolean {
  let changes = false;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      ts.isIdentifier(node.operand) &&
      node.operand.text === name
    ) {
      changes = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return changes;
}

function startsEmpty(declaration: ts.VariableDeclaration): boolean {
  const init = declaration.initializer;
  return (
    init === undefined ||
    init.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(init) && init.text === 'undefined')
  );
}

// The functions a factory hands out: what its `return` holds, the members of a
// returned object, and local functions the return names.
function escaping(body: ts.Block): ts.Node[] {
  const out: ts.Node[] = [];
  const locals = new Map<string, ts.Node>();
  for (const statement of body.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      locals.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          init !== undefined &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          locals.set(declaration.name.text, init);
        }
      }
    }
  }
  const take = (expression: ts.Node): void => {
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node)) out.push(node);
      if (ts.isIdentifier(node)) {
        const local = locals.get(node.text);
        if (local !== undefined) out.push(local);
      }
      ts.forEachChild(node, visit);
    };
    visit(expression);
  };
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
      take(statement.expression);
    }
  }
  return out;
}

// The inputs of the functions a factory hands out: their own parameters.
function parametersOf(nodes: readonly ts.Node[]): Set<string> {
  const names = new Set<string>();
  for (const node of nodes) {
    if (ts.isFunctionLike(node)) {
      for (const parameter of node.parameters) boundNames(parameter.name, names);
    }
  }
  return names;
}

// Identifiers an expression reads, writes to the left of `=` excluded.
function readsOf(expression: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isReference(node) && !isWriteTarget(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return names;
}

// A `let` that starts empty and only ever takes a value computed from what the
// factory was given, never from itself, another factory `let` or an input of a
// function the factory returns: it caches one answer and cannot count or collect.
function isMemoSlot(
  body: ts.Block,
  declaration: ts.VariableDeclaration,
  held: string,
  lets: ReadonlySet<string>,
): boolean {
  if (!startsEmpty(declaration) || changesInPlace(body, held)) return false;
  const inputs = parametersOf(escaping(body));
  return assignmentsOf(body, held).every((assignment) => {
    if (!PLAIN.has(assignment.operatorToken.kind)) return false;
    return [...readsOf(assignment.right)].every((name) => !lets.has(name) && !inputs.has(name));
  });
}

// What a function body keeps alive for the closures it creates.
function stateOf(source: Source, name: string, fn: ts.FunctionLikeDeclaration): Factory | null {
  const body = fn.body;
  if (body === undefined || !ts.isBlock(body)) return null;
  const lets = new Set<string>();
  for (const statement of body.statements) {
    if (
      ts.isVariableStatement(statement) &&
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      for (const declaration of statement.declarationList.declarations) {
        boundNames(declaration.name, lets);
      }
    }
  }
  for (const statement of body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isLet = (statement.declarationList.flags & ts.NodeFlags.Const) === 0;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const held = declaration.name.text;
      if (!capturedIn(body, held)) continue;
      const init = declaration.initializer;
      const mutable = isLet
        ? !isMemoSlot(body, declaration, held, lets)
        : init !== undefined &&
          isMutableValue(init) &&
          mutationOf(source.tree, body, watching(body, held, null)) !== null;
      if (mutable)
        return { name, file: source.file, holds: held, at: lineOf(source.tree, declaration) };
    }
  }
  return null;
}

function functionOf(node: ts.Node): ts.FunctionLikeDeclaration | null {
  if (ts.isFunctionDeclaration(node)) return node;
  if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
    const init = unwrap(node.initializer);
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  }
  return null;
}

function factoriesOf(source: Source): Factory[] {
  const found: Factory[] = [];
  const add = (names: readonly string[], fn: ts.FunctionLikeDeclaration): void => {
    const state = stateOf(source, names[0] ?? '', fn);
    if (state !== null) for (const name of names) found.push({ ...state, name });
  };
  for (const statement of source.tree.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      add(
        [
          ...(statement.name === undefined ? [] : [statement.name.text]),
          ...(isDefault ? ['default'] : []),
        ],
        statement,
      );
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const fn = functionOf(declaration);
        if (fn !== null && ts.isIdentifier(declaration.name)) add([declaration.name.text], fn);
      }
    }
    if (ts.isExportAssignment(statement)) {
      const value = unwrap(statement.expression);
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) add(['default'], value);
    }
  }
  return found;
}

// Local name to the name the module exports it as, for named, aliased and
// default imports, plus the namespaces a member call may go through.
function importsOf(tree: ts.SourceFile): { named: Map<string, string>; spaces: Set<string> } {
  const named = new Map<string, string>();
  const spaces = new Set<string>();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined) continue;
    const clause = statement.importClause;
    if (clause.name !== undefined) named.set(clause.name.text, 'default');
    const bindings = clause.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        named.set(element.name.text, (element.propertyName ?? element.name).text);
      }
    }
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) spaces.add(bindings.name.text);
  }
  return { named, spaces };
}

// Calls and `new`s made while the module loads: not inside a function or class body.
function loadTime(statement: ts.Statement): (ts.CallExpression | ts.NewExpression)[] {
  const calls: (ts.CallExpression | ts.NewExpression)[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer !== undefined) visit(declaration.initializer);
    }
  } else if (ts.isExpressionStatement(statement) || ts.isExportAssignment(statement)) {
    visit(statement.expression);
  }
  return calls;
}

function isScanned(file: string): boolean {
  return (
    /\.[cm]?tsx?$/u.test(file) &&
    !/\.test\.[cm]?tsx?$/u.test(file) &&
    !file.endsWith('.d.ts') &&
    !file.startsWith('src/testing/')
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((each) => each.kind === kind)
  );
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

// Exported collections and objects, by the name they are exported under.
function exportedValues(source: Source): Map<string, Candidate> {
  const { file, tree } = source;
  const local = new Map<string, Candidate>();
  const out = new Map<string, Candidate>();
  for (const statement of tree.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (ts.isIdentifier(declaration.name) && init !== undefined && isMutableValue(init)) {
        const value = unwrap(init);
        const candidate = {
          name: declaration.name.text,
          file,
          line: lineOf(tree, declaration),
          object: ts.isObjectLiteralExpression(value) ? value : null,
        };
        local.set(candidate.name, candidate);
        if (isExported(statement)) out.set(candidate.name, candidate);
      }
    }
  }
  for (const statement of tree.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      const candidate = local.get(statement.expression.text);
      if (candidate !== undefined) out.set('default', candidate);
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const candidate = local.get((element.propertyName ?? element.name).text);
        if (candidate !== undefined) out.set(element.name.text, candidate);
      }
    }
  }
  return out;
}

interface ClassState {
  name: string;
  changes: string | null;
}

function classesOf(source: Source): ClassState[] {
  const found: ClassState[] = [];
  for (const statement of source.tree.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name === undefined) continue;
    let changes: string | null = null;
    for (const member of statement.members) {
      if (ts.isMethodDeclaration(member) && member.body !== undefined && changes === null) {
        const line = mutationOf(source.tree, member.body, {
          names: new Set(['this']),
          methods: new Set(),
          own: new Set(),
        });
        if (line !== null) changes = member.name.getText();
      }
    }
    found.push({ name: statement.name.text, changes });
  }
  return found;
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
  const factories = sources.flatMap((source) => factoriesOf(source));
  const exported = new Map<string, Candidate[]>();
  for (const source of sources) {
    for (const [name, candidate] of exportedValues(source)) {
      exported.set(name, [...(exported.get(name) ?? []), candidate]);
    }
  }
  const classes = new Map<string, ClassState[]>();
  for (const source of sources) classes.set(source.file, classesOf(source));
  const found = new Set<string>();
  for (const source of sources) {
    const { file, tree } = source;
    const { named, spaces } = importsOf(tree);
    const add = (line: number, what: string): void => {
      found.add(`${file}:${String(line)}: ${what}`);
    };
    for (const statement of tree.statements) {
      if (ts.isVariableStatement(statement)) {
        const word =
          (statement.declarationList.flags & ts.NodeFlags.Const) === 0 ? 'let or var' : null;
        for (const declaration of statement.declarationList.declarations) {
          const names = new Set<string>();
          boundNames(declaration.name, names);
          const line = lineOf(tree, declaration);
          const keyword =
            (statement.declarationList.flags & ts.NodeFlags.Let) !== 0 ? 'let' : 'var';
          if (word !== null) {
            add(line, `top-level ${keyword} ${[...names].join(', ')}`);
          } else if (
            ts.isIdentifier(declaration.name) &&
            declaration.initializer !== undefined &&
            isMutableValue(declaration.initializer)
          ) {
            const value = unwrap(declaration.initializer);
            const object = ts.isObjectLiteralExpression(value) ? value : null;
            const at = mutationOf(tree, tree, watching(tree, declaration.name.text, object));
            const own = object === null ? null : selfMutation(tree, object);
            if (at !== null || own !== null) {
              add(
                line,
                `top-level ${declaration.name.text} is mutated at line ${String(at ?? own)}`,
              );
            }
          }
        }
      }
      if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
        for (const member of statement.members) {
          const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword);
          const readonly = hasModifier(member, ts.SyntaxKind.ReadonlyKeyword);
          if (ts.isPropertyDeclaration(member) && isStatic && !readonly) {
            add(
              lineOf(tree, member),
              `class ${statement.name.text} holds static state ${member.name.getText()}`,
            );
          }
        }
      }
      for (const call of loadTime(statement)) {
        const callee = ts.isNewExpression(call) ? call.expression : unwrap(call.expression);
        const callable =
          ts.isArrowFunction(callee) || ts.isFunctionExpression(callee) ? callee : null;
        if (callable !== null && ts.isCallExpression(call)) {
          const state = stateOf(source, 'an immediately called function', callable);
          if (state !== null) {
            add(
              lineOf(tree, call),
              `an immediately called function keeps ${state.holds} (line ${String(state.at)}) alive for every caller`,
            );
          }
          continue;
        }
        let target: string | null = null;
        if (ts.isIdentifier(callee)) target = named.get(callee.text) ?? callee.text;
        if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          spaces.has(callee.expression.text)
        ) {
          target = callee.name.text;
        }
        if (target === null) continue;
        const local = ts.isIdentifier(callee) ? callee.text : null;
        if (ts.isNewExpression(call)) {
          for (const [classFile, states] of classes) {
            const state = states.find(
              (each) =>
                each.name === target &&
                each.changes !== null &&
                (classFile === file || named.has(local ?? '')),
            );
            if (state !== undefined) {
              add(
                lineOf(tree, call),
                `new ${target}() at module scope: ${target} changes this in ${state.changes ?? ''}`,
              );
            }
          }
          continue;
        }
        const factory = factories.find(
          (each) =>
            each.name === target &&
            (each.file === file || named.has(local ?? target) || spaces.size > 0),
        );
        if (factory !== undefined) {
          add(
            lineOf(tree, call),
            `${target}() at module scope keeps ${factory.holds} (${factory.file}:${String(factory.at)}) alive for every caller`,
          );
        }
      }
    }
    for (const [local, name] of named) {
      for (const candidate of exported.get(name) ?? []) {
        if (candidate.file === file) continue;
        const at = mutationOf(tree, tree, watching(tree, local, candidate.object));
        if (at !== null) {
          found.add(
            `${candidate.file}:${String(candidate.line)}: top-level ${candidate.name} is mutated at ${file}:${String(at)}`,
          );
        }
      }
    }
    const visit = (node: ts.Node): void => {
      if (
        ts.isBinaryExpression(node) &&
        ASSIGNMENTS.has(node.operatorToken.kind) &&
        (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
      ) {
        const base = unwrap(node.left.expression);
        const member = memberName(node.left) ?? '';
        if (
          ts.isIdentifier(base) &&
          GLOBALS.has(base.text) &&
          !NAVIGATION.has(member) &&
          !member.startsWith('on')
        ) {
          add(
            lineOf(tree, node),
            `an assignment to ${base.text}.${member}, state outside any module`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
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
  it('keeps no mutable state at module scope, tests and testing/ excepted', async () => {
    const files = await read(CONSOLE);
    const names = [...files.keys()];
    expect(names).toContain('src/shared/lib/repository/useDrafts.ts');
    expect(names).toContain('src/app/lazyFeatureRoute/lazyFeatureRoute.tsx');
    expect(names).toContain('src/shared/api/transport/gateway.ts');
    expect(violations(files)).toEqual([]);
  });

  it('holds the docs app to the same rule, tests excepted', async () => {
    const files = await read(DOCS);
    const names = [...files.keys()];
    expect(names).toContain('src/features/landing/use-cases/useSignInFlow.ts');
    expect(names).toContain('src/shared/ui/Diagram/diagrams.tsx');
    expect(violations(files)).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass`);
    expect(files.size).toBeGreaterThan(8);
    expect(violations(files)).toEqual([]);
  });

  it('fail every non-conforming fixture, naming the file and the line', async () => {
    const files = await read(`${FIXTURES}/fail`);
    expect(files.size).toBeGreaterThan(5);
    expect(violations(files)).toEqual([
      'src/app/counter.ts:9: createCounter() at module scope keeps count (src/app/counter.ts:2) alive for every caller',
      'src/app/flag.ts:6: makeLatch() at module scope keeps open (src/app/flag.ts:2) alive for every caller',
      'src/shared/api/transport/gateway.ts:3: createEvents() at module scope keeps listeners (src/shared/api/transport/events.ts:2) alive for every caller',
      'src/shared/lib/repository/counter.ts:1: top-level let issued',
      'src/shared/lib/repository/registry.ts:1: top-level sources is mutated at line 8',
      'src/shared/lib/repository/registry.ts:2: top-level queue is mutated at line 9',
      'src/shared/lib/repository/registry.ts:3: top-level state is mutated at line 10',
      'src/shared/lib/repository/registry.ts:4: top-level seen is mutated at line 12',
      'src/shared/lib/repository/registry.ts:5: top-level options is mutated at line 13',
      'src/shared/lib/repository/ticks.ts:1: top-level clock is mutated at line 4',
      'src/shared/lib/services/alias.ts:1: top-level seen is mutated at line 14',
      'src/shared/lib/services/alias.ts:3: top-level pending is mutated at line 15',
      'src/shared/lib/services/alias.ts:5: top-level names is mutated at line 16',
      'src/shared/lib/services/alias.ts:6: top-level typed is mutated at line 17',
      'src/shared/lib/services/alias.ts:7: top-level fresh is mutated at line 18',
      'src/shared/lib/services/alias.ts:8: top-level copy is mutated at line 19',
      'src/shared/lib/services/alias.ts:9: top-level pushed is mutated at line 20',
      'src/shared/lib/services/alias.ts:10: top-level quiet is mutated at line 21',
      'src/shared/lib/services/alias.ts:11: top-level target is mutated at line 22',
      'src/shared/lib/services/cache.ts:1: top-level cache is mutated at src/shared/lib/services/put.ts:4',
      'src/shared/lib/services/cache.ts:2: top-level log is mutated at src/shared/lib/services/put.ts:5',
      'src/shared/lib/services/cache.ts:3: top-level settings is mutated at src/shared/lib/services/put.ts:6',
      'src/shared/lib/services/classes.ts:2: class Counter holds static state count',
      'src/shared/lib/services/classes.ts:18: new Bus() at module scope: Bus changes this in push',
      'src/shared/lib/services/classes.ts:19: top-level tally is mutated at line 22',
      'src/shared/lib/services/globals.ts:2: an assignment to window.lastSeen, state outside any module',
      'src/shared/lib/services/globals.ts:3: an assignment to globalThis.seen, state outside any module',
      'src/shared/lib/services/iife.ts:1: an immediately called function keeps n (line 2) alive for every caller',
      'src/shared/lib/services/members.ts:4: createEvents() at module scope keeps listeners (src/shared/api/transport/events.ts:2) alive for every caller',
      'src/shared/lib/services/members.ts:5: createEvents() at module scope keeps listeners (src/shared/api/transport/events.ts:2) alive for every caller',
      'src/shared/lib/services/members.ts:6: default() at module scope keeps listeners (src/shared/api/transport/events.ts:12) alive for every caller',
      'src/shared/lib/services/memo.ts:37: counter() at module scope keeps n (src/shared/lib/services/memo.ts:2) alive for every caller',
      'src/shared/lib/services/memo.ts:38: twoSlots() at module scope keeps a (src/shared/lib/services/memo.ts:10) alive for every caller',
      'src/shared/lib/services/memo.ts:39: collects() at module scope keeps seen (src/shared/lib/services/memo.ts:20) alive for every caller',
      'src/shared/lib/services/memo.ts:40: holder() at module scope keeps current (src/shared/lib/services/memo.ts:28) alive for every caller',
      'src/shared/lib/services/var.ts:1: top-level var visits',
    ]);
  });
});
