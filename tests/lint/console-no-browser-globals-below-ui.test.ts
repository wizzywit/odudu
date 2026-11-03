import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A console use case, repository or service reads no page global itself: `location`, `document`,
// `window`, `navigator`, `localStorage`, `sessionStorage` and `console`, bare or through
// `globalThis`. The one place the page is read is `shared/api/adapter` or `shared/lib/platform`,
// which a use case or repository calls, so a test drives it without faking a global. A view may
// keep its DOM integration (focus, scrolling, listeners, the clipboard): it is the layer that
// draws. Not seen: a global reached through an alias or `self`, and a local that shadows one is
// flagged too, so rename it. Nothing here is waived.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE = 'apps/admin-console';
const FIXTURES = 'tests/lint/fixtures/console-no-browser-globals-below-ui';

const GLOBALS = new Set([
  'location',
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'console',
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
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'globalThis' &&
        GLOBALS.has(node.name.text)
      ) {
        found.push(
          `${file}:${String(lineOf(tree, node))}: the browser global globalThis.${node.name.text}`,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return found.sort();
}

async function read(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob('src/**/{use-cases,repository,services}/**/*.{ts,tsx}', {
    cwd: path.join(REPO_ROOT, root),
  })) {
    if (/\.test\.tsx?$/u.test(file)) continue;
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, root, file), 'utf8'));
  }
  return files;
}

describe('use cases, repositories and services in the console', { timeout: 60_000 }, () => {
  it('touch no browser global', async () => {
    const files = await read(CONSOLE);
    const names = [...files.keys()];
    expect(names).toContain('src/shared/lib/repository/useUrlSearch.ts');
    expect(names).toContain('src/shared/lib/use-cases/useFocusWhen.ts');
    expect(violations(files)).toEqual([]);
  });

  it('pass the conforming fixture, and read neither a view, an adapter nor the platform folder', async () => {
    const files = await read(`${FIXTURES}/pass`);
    expect([...files.keys()]).toEqual(['src/features/a/use-cases/useQuiet.ts']);
    expect(violations(files)).toEqual([]);
  });

  it('fail every non-conforming fixture, naming the file and the line', async () => {
    const files = await read(`${FIXTURES}/fail`);
    expect(files.size).toBe(3);
    expect(violations(files)).toEqual([
      'src/features/a/repository/report.ts:2: the browser global console',
      'src/features/a/services/title.ts:2: the browser global document',
      'src/features/a/use-cases/useGlobals.ts:1: the browser global window',
      'src/features/a/use-cases/useGlobals.ts:2: the browser global document',
      'src/features/a/use-cases/useGlobals.ts:3: the browser global navigator',
      'src/features/a/use-cases/useGlobals.ts:4: the browser global localStorage',
      'src/features/a/use-cases/useGlobals.ts:5: the browser global sessionStorage',
      'src/features/a/use-cases/useGlobals.ts:6: the browser global globalThis.location',
      'src/features/a/use-cases/useGlobals.ts:7: the browser global location',
      'src/features/a/use-cases/useGlobals.ts:8: the browser global console',
    ]);
  });
});
