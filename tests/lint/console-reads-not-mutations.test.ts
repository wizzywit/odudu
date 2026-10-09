import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A read of the server is a query, never a mutation: a mutation's result is
// not shared, cached or deduplicated, and wrapping a read in one hides it
// from everything that reasons about reads. A confirmation that must reach
// the server is a query with `staleTime: 0` (`useFreshRead`). A read is an adapter
// function named find…, read… or list… that is handed the gateway; reading
// a file the operator chose is not one.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SOURCES = 'apps/admin-console/src/**/*.{ts,tsx}';
const FIXTURES = 'tests/lint/fixtures/console-reads-not-mutations';
const READ = /^(?:find|read|list)[A-Z]/u;

function adapterImports(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const from = (statement.moduleSpecifier as ts.StringLiteral).text;
    if (!/\/adapter(?:\/|\.ts$)/u.test(from)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) names.add(element.name.text);
  }
  return names;
}

export function violations(fileName: string, source: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const reads = adapterImports(file);
  const found: string[] = [];
  const inside = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      READ.test(node.expression.text) &&
      reads.has(node.expression.text) &&
      node.arguments[0]?.getText() === 'gateway'
    ) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${String(line + 1)}: ${node.expression.text}`);
    }
    ts.forEachChild(node, inside);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText() === 'mutationFn') {
      inside(node.initializer);
      return;
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
    files.set(posix, await readFile(path.join(REPO_ROOT, file), 'utf8'));
  }
  return files;
}

describe("the console's mutations", { timeout: 60_000 }, () => {
  it('never wrap a read of the server', async () => {
    const files = await read(CONSOLE_SOURCES);
    expect(files.size).toBeGreaterThan(100);
    const offenders = [...files].flatMap(([file, source]) =>
      violations(file, source).map((v) => `${file}:${v}`),
    );
    expect(offenders).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass/*`);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) expect(violations(file, source), file).toEqual([]);
  });

  it('fail every non-conforming fixture', async () => {
    const files = await read(`${FIXTURES}/fail/*`);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) expect(violations(file, source), file).not.toEqual([]);
  });
});
