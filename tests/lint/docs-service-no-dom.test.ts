import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A docs service is pure: it is handed what the browser knows, so nothing in it can depend on a
// page. Flagged in every non-test file under a `services` folder: a browser global (window,
// document, navigator, storage, matchMedia, observers, frame, idle and timer functions), a DOM
// method by name (getBoundingClientRect, querySelector(All), add/removeEventListener, set/
// removeAttribute, observe, disconnect), a DOM type (Document, Window, Element, HTMLElement, Node,
// Event). Not seen: a global reached via `globalThis` or an alias, a DOM value typed `unknown`.
// A local variable named like a global is flagged too, so rename it. Nothing here is waived.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const DOCS = 'apps/docs';
const FIXTURES = 'tests/lint/fixtures/docs-service-no-dom';

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
const METHODS = new Set([
  'getBoundingClientRect',
  'querySelector',
  'querySelectorAll',
  'addEventListener',
  'removeEventListener',
  'setAttribute',
  'removeAttribute',
  'observe',
  'disconnect',
]);
const DOM_TYPES = new Set([
  'Document',
  'Window',
  'Element',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Event',
  'MediaQueryList',
]);

function lineOf(tree: ts.SourceFile, node: ts.Node): number {
  return tree.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

// A name that declares or labels something is not a reference to a global.
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  return !('name' in parent && parent.name === node);
}

export function violations(files: Map<string, string>): string[] {
  const found: string[] = [];
  for (const [file, text] of files) {
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const visit = (node: ts.Node): void => {
      const report = (what: string): void => {
        found.push(`${file}:${String(lineOf(tree, node))}: ${what}`);
      };
      if (ts.isIdentifier(node) && GLOBALS.has(node.text) && isReference(node)) {
        report(`the browser global ${node.text}`);
      }
      if (ts.isPropertyAccessExpression(node) && METHODS.has(node.name.text)) {
        report(`the DOM method ${node.name.text}`);
      }
      if (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        DOM_TYPES.has(node.typeName.text)
      ) {
        report(`the DOM type ${node.typeName.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return found.sort();
}

async function read(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob('src/**/services/**/*.{ts,tsx}', {
    cwd: path.join(REPO_ROOT, root),
  })) {
    if (/\.test\.tsx?$/u.test(file)) continue;
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, root, file), 'utf8'));
  }
  return files;
}

describe('services in the docs app', { timeout: 60_000 }, () => {
  it('touch no browser global, DOM method or DOM type', async () => {
    const files = await read(DOCS);
    const names = [...files.keys()];
    expect(names).toContain('src/features/landing/services/reveal.ts');
    expect(names).toContain('src/features/landing/services/typewriter.ts');
    expect(violations(files)).toEqual([]);
  });

  it('pass the conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass`);
    expect(files.size).toBeGreaterThan(0);
    expect(violations(files)).toEqual([]);
  });

  it('fail every non-conforming fixture, naming the file and the line', async () => {
    const files = await read(`${FIXTURES}/fail`);
    expect(files.size).toBe(3);
    expect(violations(files)).toEqual([
      'src/features/a/services/Globals.ts:1: the browser global window',
      'src/features/a/services/Globals.ts:2: the browser global document',
      'src/features/a/services/Globals.ts:3: the browser global navigator',
      'src/features/a/services/Globals.ts:4: the browser global setTimeout',
      'src/features/a/services/Globals.ts:5: the browser global IntersectionObserver',
      'src/features/a/services/Globals.ts:6: the browser global requestAnimationFrame',
      'src/features/a/services/Globals.ts:7: the browser global window',
      'src/features/a/services/Members.ts:10: the DOM method getBoundingClientRect',
      'src/features/a/services/Members.ts:8: the DOM method addEventListener',
      'src/features/a/services/Members.ts:9: the DOM method querySelectorAll',
      'src/shared/services/Types.ts:1: the DOM type Document',
      'src/shared/services/Types.ts:1: the DOM type Element',
      'src/shared/services/Types.ts:1: the DOM type HTMLElement',
      'src/shared/services/Types.ts:1: the DOM type Window',
      'src/shared/services/Types.ts:2: the DOM type HTMLElement',
    ]);
  });
});
