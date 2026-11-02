import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The docs app writes no `readonly` in a type: not a modifier, the type operator (`readonly T[]`),
// nor ReadonlyArray, ReadonlyMap, ReadonlySet or Readonly<…>. A constant that must be immutable is
// `as const`, a value's assertion, which passes. Read from apps/docs/src, tests included.
// Not seen: a type readonly because a library declared it so, one inferred from an `as const`
// value, `Object.freeze`, and a `readonly` in a .js or .mjs file. Where the compiler or a library
// forces one, raise it; nothing here is waived.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const DOCS = 'apps/docs';
const FIXTURES = 'tests/lint/fixtures/docs-no-readonly';
const READONLY_TYPES = new Set(['ReadonlyArray', 'ReadonlyMap', 'ReadonlySet', 'Readonly']);

function lineOf(tree: ts.SourceFile, node: ts.Node): number {
  return tree.getLineAndCharacterOfPosition(node.getStart()).line + 1;
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
      if (
        ts.canHaveModifiers(node) &&
        ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword)
      ) {
        report('a readonly modifier');
      }
      if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
        report('the readonly type operator');
      }
      if (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        READONLY_TYPES.has(node.typeName.text)
      ) {
        report(`${node.typeName.text} in a type`);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return found.sort();
}

async function read(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob('src/**/*.{ts,tsx}', { cwd: path.join(REPO_ROOT, root) })) {
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, root, file), 'utf8'));
  }
  return files;
}

describe('types in the docs app', { timeout: 60_000 }, () => {
  it('carry no readonly in any form', async () => {
    const files = await read(DOCS);
    const names = [...files.keys()];
    expect(names).toContain('src/features/landing/ui/Scene/Scene.tsx');
    expect(names).toContain('src/features/landing/services/geometry.ts');
    expect(violations(files)).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass`);
    expect(files.size).toBeGreaterThan(1);
    expect(violations(files)).toEqual([]);
  });

  it('fail every non-conforming fixture, naming the file and the line', async () => {
    const files = await read(`${FIXTURES}/fail`);
    expect(files.size).toBeGreaterThan(4);
    expect(violations(files)).toEqual([
      'src/Aliases.ts:1: ReadonlyMap in a type',
      'src/Aliases.ts:2: ReadonlySet in a type',
      'src/Aliases.ts:3: Readonly in a type',
      'src/Arrays.ts:1: ReadonlyArray in a type',
      'src/Arrays.ts:2: the readonly type operator',
      'src/Arrays.ts:3: the readonly type operator',
      'src/Index.ts:2: a readonly modifier',
      'src/Interface.tsx:2: a readonly modifier',
      'src/Interface.tsx:3: a readonly modifier',
      'src/Interface.tsx:6: a readonly modifier',
      'src/Parameter.ts:2: a readonly modifier',
    ]);
  });
});
