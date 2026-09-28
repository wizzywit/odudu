import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A component's props are plain properties, not `readonly` (spec §6.3): the
// object is never mutated by the component, so the modifier says nothing an
// unused array warns about, and it survived only because interfaces here
// started `readonly` by habit. An array-typed prop keeps it — `readonly
// T[]`/`ReadonlyArray<T>` is a real guarantee about the caller's array — and
// a type that only describes a prop's array elements, or any type outside a
// component's own props, is untouched.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SOURCES = 'apps/admin-console/src/**/*.tsx';
const FIXTURES = 'tests/lint/fixtures/console-plain-props';
const PASCAL_NAME = /^[A-Z][A-Za-z0-9]*$/u;

type Callable = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function unwrap(node: ts.Expression): ts.Expression {
  let inner = node;
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isNonNullExpression(inner)
  ) {
    inner = inner.expression;
  }
  return inner;
}

function isJsx(node: ts.Expression): boolean {
  const inner = unwrap(node);
  if (ts.isConditionalExpression(inner)) return isJsx(inner.whenTrue) || isJsx(inner.whenFalse);
  if (
    ts.isBinaryExpression(inner) &&
    inner.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return isJsx(inner.right);
  }
  return ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner) || ts.isJsxFragment(inner);
}

function returnsJsx(fn: Callable): boolean {
  const { body } = fn;
  if (body === undefined) return false;
  if (!ts.isBlock(body)) return isJsx(body);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined && isJsx(node.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

// A PascalCase-named function or arrow/function expression that returns
// JSX: the same shape the console's file-naming lint treats as a component.
function findComponents(file: ts.SourceFile): { name: string; fn: Callable }[] {
  const components: { name: string; fn: Callable }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name !== undefined &&
      PASCAL_NAME.test(node.name.text) &&
      returnsJsx(node)
    ) {
      components.push({ name: node.name.text, fn: node });
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !PASCAL_NAME.test(decl.name.text)) continue;
        if (decl.initializer === undefined) continue;
        const init = unwrap(decl.initializer);
        if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && returnsJsx(init)) {
          components.push({ name: decl.name.text, fn: init });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return components;
}

// A `readonly T[]`/`ReadonlyArray<T>` prop is the one place `readonly`
// stays: it is a real guarantee about the caller's array, not a habit.
function isReadonlyArrayLike(typeNode: ts.TypeNode | undefined): boolean {
  if (typeNode === undefined) return false;
  if (ts.isTypeOperatorNode(typeNode) && typeNode.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return ts.isArrayTypeNode(typeNode.type);
  }
  return ts.isTypeReferenceNode(typeNode) && typeNode.typeName.getText() === 'ReadonlyArray';
}

// Follows a props parameter's type to the object-shaped nodes it names,
// stopping at an array element's own type: `readonly Column<T>[]` never
// pulls in `Column`, which describes rows, not this component's props.
type PropsNode = ts.TypeLiteralNode | ts.InterfaceDeclaration;

function propsTypeNodes(file: ts.SourceFile, fn: Callable): PropsNode[] {
  const typeAliases = new Map<string, ts.TypeAliasDeclaration>();
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  for (const statement of file.statements) {
    if (ts.isTypeAliasDeclaration(statement)) typeAliases.set(statement.name.text, statement);
    if (ts.isInterfaceDeclaration(statement)) interfaces.set(statement.name.text, statement);
  }

  const found = new Set<PropsNode>();
  const seenNames = new Set<string>();

  function visit(typeNode: ts.TypeNode | undefined): void {
    if (typeNode === undefined) return;
    if (ts.isTypeLiteralNode(typeNode)) {
      found.add(typeNode);
      return;
    }
    if (ts.isIntersectionTypeNode(typeNode) || ts.isUnionTypeNode(typeNode)) {
      for (const t of typeNode.types) visit(t);
      return;
    }
    if (ts.isParenthesizedTypeNode(typeNode)) {
      visit(typeNode.type);
      return;
    }
    if (ts.isTypeReferenceNode(typeNode)) {
      const name = typeNode.typeName.getText();
      if (seenNames.has(name)) return;
      seenNames.add(name);
      const alias = typeAliases.get(name);
      if (alias !== undefined) {
        visit(alias.type);
        return;
      }
      // An interface's own members are checked, ignoring `extends` (a base
      // such as react-aria's own props is not this console's props type).
      const iface = interfaces.get(name);
      if (iface !== undefined) found.add(iface);
    }
  }

  const [firstParam] = fn.parameters;
  visit(firstParam?.type);
  return [...found];
}

function violations(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];
  for (const { name, fn } of findComponents(file)) {
    for (const typeNode of propsTypeNodes(file, fn)) {
      for (const member of typeNode.members) {
        if (!ts.isPropertySignature(member)) continue;
        const isReadonly = (member.modifiers ?? []).some(
          (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword,
        );
        if (!isReadonly) continue;
        if (isReadonlyArrayLike(member.type)) continue;
        const propName = member.name.getText();
        found.push(`${name}.${propName}`);
      }
    }
  }
  return found;
}

async function read(pattern: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob(pattern, { cwd: REPO_ROOT })) {
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, file), 'utf8'));
  }
  return files;
}

describe("the console's component props", () => {
  it('are plain properties in every console source file', async () => {
    const files = await read(CONSOLE_SOURCES);
    expect([...files.keys()]).toContain('apps/admin-console/src/app/App.tsx');
    const offenders = [...files].flatMap(([file, source]) =>
      violations(path.posix.basename(file), source).map((v) => `${file}: ${v}`),
    );
    expect(offenders).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass/*`);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) {
      expect(violations(path.posix.basename(file), source), file).toEqual([]);
    }
  });

  it('fail every non-conforming fixture', async () => {
    const files = await read(`${FIXTURES}/fail/*`);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) {
      expect(violations(path.posix.basename(file), source), file).not.toEqual([]);
    }
  });
});
