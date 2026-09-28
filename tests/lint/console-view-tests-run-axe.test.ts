import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Every view test asserts accessibility (spec §9's Unit row): importing
// `axeInBothThemes` is not enough, since an unused import proves nothing —
// the test has to actually call it.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const VIEW_TEST_GLOBS = [
  'apps/admin-console/src/shared/view/**/*.test.tsx',
  'apps/admin-console/src/features/*/view/**/*.test.tsx',
];
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

async function read(pattern: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob(pattern, { cwd: REPO_ROOT })) {
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, file), 'utf8'));
  }
  return files;
}

describe("the console's view tests", () => {
  it('all run axe in both themes', async () => {
    const files = new Map<string, string>();
    for (const pattern of VIEW_TEST_GLOBS) {
      for (const [file, source] of await read(pattern)) files.set(file, source);
    }
    expect(files.size).toBeGreaterThan(0);
    expect([...files.keys()]).toContain('apps/admin-console/src/shared/view/DialogFrame.test.tsx');
    const offenders = [...files]
      .filter(([file, source]) => !runsAxe(path.posix.basename(file), source))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it('passes every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass/*`);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) {
      expect(runsAxe(path.posix.basename(file), source), file).toBe(true);
    }
  });

  it('fails every non-conforming fixture', async () => {
    const files = await read(`${FIXTURES}/fail/*`);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) {
      expect(runsAxe(path.posix.basename(file), source), file).toBe(false);
    }
  });
});
