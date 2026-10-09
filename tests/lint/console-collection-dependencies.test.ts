import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// React Aria keeps a dynamic collection's item rendering until the item
// changes, and the React Compiler keeps the items array between renders, so
// an item render reading more than its item shows stale output unless the
// collection names it in `dependencies`. This reports an arrow child that
// reads an identifier neither declared in it nor at module level, on a
// collection with no `dependencies`. A backstop: a value reached through a
// function the render calls is beyond a syntactic check.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SOURCES = 'apps/admin-console/src/**/*.tsx';
const FIXTURES = 'tests/lint/fixtures/console-collection-dependencies';
const COLLECTIONS = new Set([
  'ListBox',
  'GridList',
  'Menu',
  'TagList',
  'TableBody',
  'Collection',
  'Tree',
]);

function bindingNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) bindingNames(element.name, into);
  }
}

function moduleLevelNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name !== undefined) names.add(clause.name.text);
      const named = clause?.namedBindings;
      if (named !== undefined && ts.isNamespaceImport(named)) names.add(named.name.text);
      if (named !== undefined && ts.isNamedImports(named)) {
        for (const element of named.elements) names.add(element.name.text);
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        bindingNames(declaration.name, names);
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

function declaredWithin(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (at: ts.Node): void => {
    if (ts.isParameter(at) || ts.isVariableDeclaration(at) || ts.isBindingElement(at)) {
      if (ts.isIdentifier(at.name) || !ts.isBindingElement(at)) bindingNames(at.name, names);
    }
    if (ts.isFunctionDeclaration(at) && at.name !== undefined) names.add(at.name.text);
    ts.forEachChild(at, visit);
  };
  visit(node);
  return names;
}

function isReference(identifier: ts.Identifier): boolean {
  const { parent } = identifier;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === identifier) return false;
  if (ts.isJsxAttribute(parent) && parent.name === identifier) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === identifier) return false;
  if (ts.isQualifiedName(parent) || ts.isTypeReferenceNode(parent)) return false;
  for (let at: ts.Node = parent; !ts.isSourceFile(at); at = at.parent) {
    if (ts.isTypeNode(at)) return false;
  }
  return true;
}

function capturedBy(render: ts.ArrowFunction | ts.FunctionExpression, top: Set<string>): string[] {
  const own = declaredWithin(render);
  const found = new Set<string>();
  const visit = (at: ts.Node): void => {
    if (
      ts.isIdentifier(at) &&
      isReference(at) &&
      !own.has(at.text) &&
      !top.has(at.text) &&
      !Object.hasOwn(globalThis, at.text) &&
      at.text !== 'undefined'
    ) {
      found.add(at.text);
    }
    ts.forEachChild(at, visit);
  };
  visit(render.body);
  return [...found];
}

function tagName(element: ts.JsxOpeningElement): string {
  const tag = element.tagName;
  return ts.isPropertyAccessExpression(tag) ? tag.name.text : tag.getText();
}

export function violations(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const top = moduleLevelNames(file);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && COLLECTIONS.has(tagName(node.openingElement))) {
      const named = node.openingElement.attributes.properties.some(
        (property) => ts.isJsxAttribute(property) && property.name.getText() === 'dependencies',
      );
      for (const child of node.children) {
        const render = ts.isJsxExpression(child) ? child.expression : undefined;
        if (
          render === undefined ||
          !(ts.isArrowFunction(render) || ts.isFunctionExpression(render))
        ) {
          continue;
        }
        const captured = capturedBy(render, top);
        if (!named && captured.length > 0) {
          const { line } = file.getLineAndCharacterOfPosition(node.getStart());
          found.push(
            `${String(line + 1)}: ${tagName(node.openingElement)} renders with ${captured.join(', ')} but names no dependencies`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

async function read(pattern: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob(pattern, { cwd: REPO_ROOT })) {
    const posix = file.split(path.sep).join('/');
    if (posix.endsWith('.test.tsx')) continue;
    files.set(posix, await readFile(path.join(REPO_ROOT, file), 'utf8'));
  }
  return files;
}

describe("the console's dynamic collections", { timeout: 60_000 }, () => {
  it('name what their item render reads besides the item', async () => {
    const files = await read(CONSOLE_SOURCES);
    expect([...files.keys()]).toContain('apps/admin-console/src/shared/view/Picker/Picker.tsx');
    const offenders = [...files].flatMap(([file, source]) =>
      violations(file, source).map((v) => `${file}:${v}`),
    );
    expect(offenders).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass/*`);
    expect(files.size).toBeGreaterThanOrEqual(2);
    for (const [file, source] of files) expect(violations(file, source), file).toEqual([]);
  });

  it('fail every non-conforming fixture', async () => {
    const files = await read(`${FIXTURES}/fail/*`);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) expect(violations(file, source), file).not.toEqual([]);
  });
});
