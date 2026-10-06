import { existsSync } from 'node:fs';
import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The React Compiler memoises the console (ADR 0041), so a hand-written
// useMemo, useCallback or memo() is not needed and is not added. The one
// way in is a measurement: the line above the call is
// `// measured: <path>`, and the file it names exists.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SOURCES = 'apps/admin-console/src/**/*.{ts,tsx}';
const FIXTURES = 'tests/lint/fixtures/console-no-manual-memo';
const MANUAL = new Set(['useMemo', 'useCallback', 'memo']);
const MEASURED = /^\s*\/\/ measured: (\S+)\s*$/u;

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

export function violations(fileName: string, source: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const lines = source.split('\n');
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const name = ts.isCallExpression(node) ? calleeName(node) : null;
    if (name !== null && MANUAL.has(name)) {
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
    expect(files.size).toBeGreaterThanOrEqual(5);
    for (const [file, source] of files) expect(violations(file, source), file).not.toEqual([]);
  });
});
