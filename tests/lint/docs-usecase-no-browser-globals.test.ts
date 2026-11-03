import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A docs use case reaches the browser through `shared/lib/platform` (or a feature's own `platform`
// folder), never directly, so a test drives it without faking a global. Flagged in every non-test
// file under a `use-cases` folder: a reference to window, document, navigator, location, history,
// storage, matchMedia, getComputedStyle, the observers, frame, idle and timer functions. Not seen:
// a global reached via `globalThis` or an alias, a DOM method on a value handed in. A local named
// like a global is flagged too, so rename it. Nothing here is waived.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const DOCS = 'apps/docs';
const FIXTURES = 'tests/lint/fixtures/docs-usecase-no-browser-globals';

const GLOBALS = new Set([
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'matchMedia',
  'getComputedStyle',
  'IntersectionObserver',
  'MutationObserver',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
]);

function lineOf(tree: ts.SourceFile, node: ts.Node): number {
  return tree.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

// A name that declares or labels something is not a reference to a global.
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  return !('name' in parent && parent.name === node);
}

export function violations(files: Map<string, string>): string[] {
  const found: string[] = [];
  for (const [file, text] of files) {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && GLOBALS.has(node.text) && isReference(node)) {
        found.push(`${file}:${String(lineOf(tree, node))}: the browser global ${node.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return found.sort();
}

async function read(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob('src/**/use-cases/**/*.{ts,tsx}', {
    cwd: path.join(REPO_ROOT, root),
  })) {
    if (/\.test\.tsx?$/u.test(file)) continue;
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, root, file), 'utf8'));
  }
  return files;
}

describe('use cases in the docs app', { timeout: 60_000 }, () => {
  it('touch no browser global', async () => {
    const files = await read(DOCS);
    const names = [...files.keys()];
    expect(names).toContain('src/features/landing/use-cases/useInstall.ts');
    expect(names).toContain('src/shared/lib/use-cases/useProbe.ts');
    expect(violations(files)).toEqual([]);
  });

  it('pass the conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass`);
    expect(files.size).toBeGreaterThan(0);
    expect(violations(files)).toEqual([]);
  });

  it('fail every non-conforming fixture, naming the file and the line', async () => {
    const files = await read(`${FIXTURES}/fail`);
    expect(files.size).toBe(2);
    expect(violations(files)).toEqual([
      'src/features/a/use-cases/useGlobals.ts:1: the browser global window',
      'src/features/a/use-cases/useGlobals.ts:2: the browser global document',
      'src/features/a/use-cases/useGlobals.ts:3: the browser global navigator',
      'src/features/a/use-cases/useGlobals.ts:4: the browser global setTimeout',
      'src/features/a/use-cases/useGlobals.ts:5: the browser global setInterval',
      'src/features/a/use-cases/useGlobals.ts:6: the browser global requestIdleCallback',
      'src/features/a/use-cases/useGlobals.ts:7: the browser global IntersectionObserver',
      'src/features/a/use-cases/useGlobals.ts:8: the browser global document',
      'src/features/a/use-cases/useGlobals.ts:8: the browser global window',
      'src/shared/lib/use-cases/useClear.ts:2: the browser global clearTimeout',
      'src/shared/lib/use-cases/useClear.ts:3: the browser global cancelIdleCallback',
    ]);
  });
});
