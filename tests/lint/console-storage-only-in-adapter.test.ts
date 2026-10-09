import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Browser storage is an outside system, like the gateway: the keys, the raw
// reads and writes and the guards around them live in an adapter, and the
// repository decides only what to remember and when.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SRC = 'apps/admin-console/src';
const FIXTURES = 'tests/lint/fixtures/console-storage';

const STORAGES = new Set(['localStorage', 'sessionStorage']);
const GLOBALS = new Set(['globalThis', 'window', 'self']);
// `document.defaultView` is the window by another road.
const WINDOWS = new Set([...GLOBALS, 'defaultView']);

function isWindow(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return GLOBALS.has(node.text);
  return ts.isPropertyAccessExpression(node) && WINDOWS.has(node.name.text);
}
const ADAPTER = /(?:^|\/)adapter(?:\/|\.tsx?$)/u;
const TEST = /\.test\.tsx?$/u;

// A storage named as a value: bare or in shorthand, as a window's property
// by dot or by bracket, or destructured. A property of some other object
// that shares the name, a string elsewhere or a comment is not storage.
function storageLines(fileName: string, source: string): number[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = new Set<number>();
  const at = (node: ts.Node): void => {
    lines.add(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      STORAGES.has(node.argumentExpression.text)
    ) {
      at(node.argumentExpression);
    }
    if (ts.isIdentifier(node) && STORAGES.has(node.text)) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        if (isWindow(parent.expression)) at(node);
      } else if (ts.isBindingElement(parent) && (parent.propertyName ?? parent.name) === node) {
        at(node);
      } else if (
        !ts.isPropertySignature(parent) &&
        !ts.isPropertyAssignment(parent) &&
        !ts.isPropertyDeclaration(parent)
      ) {
        at(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...lines].sort((a, b) => a - b);
}

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
    .filter(([file]) => !ADAPTER.test(file) && !TEST.test(file))
    .flatMap(([file, source]) =>
      storageLines(file, source).map((line) => `${file}:${String(line)}`),
    );
}

describe('browser storage in the console', { timeout: 60_000 }, () => {
  it('is reached only from an adapter', async () => {
    const files = await read(CONSOLE_SRC);
    expect([...files.keys()]).toContain('app/App/App.tsx');
    expect(offenders(files)).toEqual([]);
  });

  it('is found by reference, not by text, outside an adapter in the fixtures', async () => {
    const files = await read(FIXTURES);
    expect([...files.keys()]).toContain('shared/adapter/theme.ts');
    expect(offenders(files)).toEqual([
      'shared/repository/reachesAround.ts:5',
      'shared/repository/reachesAround.ts:6',
      'shared/repository/reachesAround.ts:7',
      'shared/repository/reachesAround.ts:8',
      'shared/repository/useThings.ts:5',
      'shared/repository/useThings.ts:9',
      'shared/repository/useThings.ts:12',
    ]);
  });
});
