import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Every view has a test beside it, and every view test asserts
// accessibility (spec §9's Unit row): importing `axeInBothThemes` is not
// enough, since an unused import proves nothing — the test has to call it.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SRC = 'apps/admin-console/src';
// A view layer is a folder, or a single view.tsx beside the feature's other layers.
const VIEW_TESTS = [
  'shared/view/**/*.test.tsx',
  'features/*/view/**/*.test.tsx',
  'features/*/view.test.tsx',
];
const VIEWS = ['shared/view/**/*.tsx', 'features/*/view/**/*.tsx', 'features/*/view.tsx'];
const COMPONENT = /^(?:[A-Z][A-Za-z0-9]*|view)\.tsx$/u;
const FIXTURES = 'tests/lint/fixtures/console-view-axe';
const AXE_MODULE = '#/testing/axeInBothThemes.ts';
const AXE_NAME = 'axeInBothThemes';

function importsAxeHelper(file: ts.SourceFile): boolean {
  return file.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      statement.moduleSpecifier.getText().slice(1, -1) === AXE_MODULE &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) => (element.propertyName ?? element.name).text === AXE_NAME,
      ),
  );
}

function callsAxeHelper(file: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === AXE_NAME
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return found;
}

function runsAxe(fileName: string, source: string): boolean {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return importsAxeHelper(file) && callsAxeHelper(file);
}

async function read(root: string, patterns: readonly string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const pattern of patterns) {
    for await (const file of glob(`${root}/${pattern}`, { cwd: REPO_ROOT })) {
      const posix = file.split(path.sep).join('/');
      files.set(posix.slice(root.length + 1), await readFile(path.join(REPO_ROOT, file), 'utf8'));
    }
  }
  return files;
}

async function withoutAxe(root: string): Promise<string[]> {
  const tests = await read(root, VIEW_TESTS);
  return [...tests]
    .filter(([file, source]) => !runsAxe(path.posix.basename(file), source))
    .map(([file]) => file)
    .sort();
}

async function untested(root: string): Promise<string[]> {
  const views = await read(root, VIEWS);
  const tests = await read(root, VIEW_TESTS);
  return [...views.keys()]
    .filter((file) => COMPONENT.test(path.posix.basename(file)))
    .filter((file) => !tests.has(file.replace(/\.tsx$/u, '.test.tsx')))
    .sort();
}

describe("the console's view tests", () => {
  it('all run axe in both themes', async () => {
    const tests = await read(CONSOLE_SRC, VIEW_TESTS);
    expect([...tests.keys()]).toContain('shared/view/DialogFrame.test.tsx');
    expect(await withoutAxe(CONSOLE_SRC)).toEqual([]);
  });

  it('exist beside every view', async () => {
    const views = await read(CONSOLE_SRC, VIEWS);
    expect([...views.keys()]).toContain('features/session/view/SignIn.tsx');
    expect(await untested(CONSOLE_SRC)).toEqual([]);
  });

  it('are found in a single-file view layer, and missed beside a view, in the fixture tree', async () => {
    const tree = `${FIXTURES}/tree`;
    expect(await withoutAxe(tree)).toEqual(['features/roles/view.test.tsx']);
    expect(await untested(tree)).toEqual([
      'features/groups/view/GroupList.tsx',
      'shared/view/Banner.tsx',
    ]);
  });

  it('passes every conforming fixture', async () => {
    const files = await read(FIXTURES, ['pass/*']);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) {
      expect(runsAxe(path.posix.basename(file), source), file).toBe(true);
    }
  });

  it('fails every non-conforming fixture', async () => {
    const files = await read(FIXTURES, ['fail/*']);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) {
      expect(runsAxe(path.posix.basename(file), source), file).toBe(false);
    }
  });
});
