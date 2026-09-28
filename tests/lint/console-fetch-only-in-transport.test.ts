import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// shared/transport/ is the console's one HTTP client to the gateway: it sets
// the CSRF header and the credentials mode, so a request made anywhere else
// would go out without them.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SRC = 'apps/admin-console/src';
const FIXTURES = 'tests/lint/fixtures/console-fetch';
const TRANSPORT = 'shared/transport/';

const GLOBALS = new Set(['globalThis', 'window', 'self']);

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

function isGlobalFetch(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return callee.text === 'fetch';
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'fetch' &&
    ts.isIdentifier(callee.expression) &&
    GLOBALS.has(callee.expression.text)
  );
}

function fetchCallLines(fileName: string, source: string): number[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isGlobalFetch(unwrap(node.expression))) {
      lines.push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

// Every .ts and .tsx file under `root`, keyed by its path relative to it.
async function read(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob(`${root}/**/*.{ts,tsx}`, { cwd: REPO_ROOT })) {
    const posix = file.split(path.sep).join('/');
    files.set(posix.slice(root.length + 1), await readFile(path.join(REPO_ROOT, file), 'utf8'));
  }
  return files;
}

function offenders(files: Map<string, string>): string[] {
  return [...files]
    .filter(([file]) => !file.startsWith(TRANSPORT))
    .flatMap(([file, source]) =>
      fetchCallLines(file, source).map((line) => `${file}:${String(line)}`),
    );
}

describe('fetch in the console', () => {
  it('is called only from shared/transport/', async () => {
    const files = await read(CONSOLE_SRC);
    expect([...files.keys()]).toContain('app/App.tsx');
    expect(offenders(files)).toEqual([]);
  });

  it('is found by call, not by text, outside shared/transport/ in the fixtures', async () => {
    const files = await read(FIXTURES);
    expect([...files.keys()]).toContain(`${TRANSPORT}client.ts`);
    expect(offenders(files)).toEqual([
      'features/clients/adapter.ts:2',
      'features/clients/adapter.ts:7',
    ]);
  });
});
