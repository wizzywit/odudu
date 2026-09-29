import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// shared/transport/ is the console's one HTTP client to the gateway: it sets
// the CSRF header and the credentials mode, so a request made anywhere else,
// by fetch, XMLHttpRequest, EventSource, WebSocket or a beacon, would go out
// without them.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SRC = 'apps/admin-console/src';
const FIXTURES = 'tests/lint/fixtures/console-fetch';
const TRANSPORT = 'shared/transport/';

const GLOBALS = new Set(['globalThis', 'window', 'self']);
// Each sends a request of its own, so each would leave the page without them.
const SENDERS = new Set(['fetch', 'XMLHttpRequest', 'EventSource', 'WebSocket']);
const BEACON = 'sendBeacon';

function keyText(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  return name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name))
    ? name.text
    : undefined;
}

// A name in a property position is a member of something else, not the
// global: `client.fetch`, `{ fetch: load }`, an interface's `fetch()`.
function isMemberName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return !(ts.isIdentifier(parent.expression) && GLOBALS.has(parent.expression.text));
  }
  return (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    parent.name === node
  );
}

function leaves(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return SENDERS.has(node.text) && !isMemberName(node);
  if (ts.isPropertyAccessExpression(node)) return node.name.text === BEACON;
  if (ts.isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    return ts.isStringLiteralLike(key) && (SENDERS.has(key.text) || key.text === BEACON);
  }
  if (ts.isBindingElement(node)) {
    const taken = keyText(node.propertyName ?? node.name);
    return taken !== undefined && (SENDERS.has(taken) || taken === BEACON);
  }
  return false;
}

// Every reference to a sender outside a type, one per line: a call, an
// alias, a constructor, a destructuring, or a bracketed lookup.
function fetchCallLines(fileName: string, source: string): number[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (leaves(node)) lines.add(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...lines].sort((a, b) => a - b);
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

describe('requests in the console', { timeout: 60_000 }, () => {
  it('are made only from shared/transport/', async () => {
    const files = await read(CONSOLE_SRC);
    expect([...files.keys()]).toContain('app/App.tsx');
    expect(offenders(files)).toEqual([]);
  });

  it('are found by reference, not by text, outside shared/transport/ in the fixtures', async () => {
    const files = await read(FIXTURES);
    expect([...files.keys()]).toContain(`${TRANSPORT}client.ts`);
    expect(offenders(files)).toEqual([
      'features/clients/adapter.ts:2',
      'features/clients/adapter.ts:7',
      'features/clients/leaks.tsx:1',
      'features/clients/leaks.tsx:2',
      'features/clients/leaks.tsx:3',
      'features/clients/leaks.tsx:4',
      'features/clients/leaks.tsx:5',
      'features/clients/leaks.tsx:6',
      'features/clients/leaks.tsx:7',
      'features/clients/leaks.tsx:8',
    ]);
  });
});
