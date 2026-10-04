import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Every property the console declares, in an interface or a type, is plain
// (spec §6.3): the modifier on a property promised nothing the code relied
// on and was written by habit. The guarantee worth keeping is on the value,
// so `readonly T[]`, `ReadonlyArray`, readonly tuples, `ReadonlyMap` and
// `ReadonlySet` stay: they stop an in-place sort or push on cached data.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SOURCES = 'apps/admin-console/src/**/*.{ts,tsx}';
const FIXTURES = 'tests/lint/fixtures/console-plain-properties';

function isReadonly(member: ts.PropertySignature | ts.IndexSignatureDeclaration): boolean {
  return (member.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
}

export function violations(fileName: string, source: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertySignature(node) || ts.isIndexSignatureDeclaration(node)) &&
      isReadonly(node)
    ) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${String(line + 1)}: ${node.getText().split('\n')[0] ?? ''}`);
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

describe("the console's properties", { timeout: 60_000 }, () => {
  it('are plain in every console source file, .ts and .tsx alike', async () => {
    const files = await read(CONSOLE_SOURCES);
    expect([...files.keys()]).toContain('apps/admin-console/src/app/App.tsx');
    expect([...files.keys()]).toContain('apps/admin-console/src/shared/service/dirty.ts');
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
