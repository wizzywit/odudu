import { existsSync } from 'node:fs';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The React Compiler memoises the console (ADR 0041), so a hand-written
// useMemo, useCallback or memo() is not needed and is not added. The one
// way in is a measurement: the line above the call is
// `// measured: <path>`, and the file it names exists. An alias or a
// destructured `React` is followed; ESLint cannot take the measured line
// as a waiver without an inline disable, so this test is the one check.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SOURCES = 'apps/admin-console/src/**/*.{ts,tsx}';
const FIXTURES = 'tests/lint/fixtures/console-no-manual-memo';
const MANUAL = new Set(['useMemo', 'useCallback', 'memo']);
const MEASURED = /^\s*\/\/ measured: (\S+)\s*$/u;

// What `react` is bound to in a file: the local name of each of the three
// functions however it was imported or destructured, and the names the
// whole module is held under.
function reactBindings(file: ts.SourceFile): {
  functions: Map<string, string>;
  namespaces: Set<string>;
} {
  const functions = new Map<string, string>();
  const namespaces = new Set<string>();
  const bind = (local: string, imported: string): void => {
    if (MANUAL.has(imported)) functions.set(local, imported);
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === 'react'
    ) {
      const clause = node.importClause;
      if (clause?.name !== undefined) namespaces.add(clause.name.text);
      const named = clause?.namedBindings;
      if (named !== undefined && ts.isNamespaceImport(named)) namespaces.add(named.name.text);
      if (named !== undefined && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          bind(element.name.text, (element.propertyName ?? element.name).text);
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      ts.isIdentifier(node.initializer) &&
      namespaces.has(node.initializer.text)
    ) {
      for (const element of node.name.elements) {
        const imported = element.propertyName ?? element.name;
        if (ts.isIdentifier(element.name) && ts.isIdentifier(imported)) {
          bind(element.name.text, imported.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { functions, namespaces };
}

function manualName(
  call: ts.CallExpression,
  bound: ReturnType<typeof reactBindings>,
): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return bound.functions.get(callee.text) ?? null;
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    bound.namespaces.has(callee.expression.text) &&
    MANUAL.has(callee.name.text)
  ) {
    return callee.name.text;
  }
  return null;
}

export function violations(fileName: string, source: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const bound = reactBindings(file);
  const lines = source.split('\n');
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const name = ts.isCallExpression(node) ? manualName(node, bound) : null;
    if (name !== null) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart());
      const above = line === 0 ? undefined : MEASURED.exec(lines[line - 1] ?? '');
      const measurement = above?.[1];
      if (measurement === undefined) {
        found.push(`${String(line + 1)}: ${name} without a "// measured: <path>" line above`);
      } else if (!existsSync(path.join(REPO_ROOT, measurement))) {
        found.push(`${String(line + 1)}: ${name} names ${measurement}, which does not exist`);
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
    if (/\.test\.tsx?$/u.test(posix)) continue;
    files.set(posix, await readFile(path.join(REPO_ROOT, file), 'utf8'));
  }
  return files;
}

describe("the console's memoisation", { timeout: 60_000 }, () => {
  it('is the compiler’s: no manual useMemo, useCallback or memo() without a measurement', async () => {
    const files = await read(CONSOLE_SOURCES);
    expect([...files.keys()]).toContain('apps/admin-console/src/app/App/App.tsx');
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
    expect(files.size).toBeGreaterThanOrEqual(6);
    for (const [file, source] of files) expect(violations(file, source), file).not.toEqual([]);
  });
});
