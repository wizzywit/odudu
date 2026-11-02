import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { moduleReferences, segments } from './imports.ts';
import { checkRule } from './rule.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const FIXTURE_ROOT = path.join(import.meta.dirname, '../fixtures/architecture/no-adapter-export');
const PATTERNS = [
  'apps/admin-console/src/{features,pages,entities}/*/index.{ts,tsx}',
  'apps/docs/src/{features,pages,entities}/*/index.{ts,tsx}',
];

function exportsAdapter(file: string, text: string): boolean {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const exported = new Set(
    source.statements
      .filter(ts.isExportDeclaration)
      .flatMap((statement) =>
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? [statement.moduleSpecifier.text]
          : [],
      ),
  );
  return moduleReferences(file, text).some(
    (reference) =>
      exported.has(reference.specifier) && segments(reference.specifier).includes('adapter'),
  );
}

export async function findAdapterExports(root: string): Promise<string[]> {
  const breaches: string[] = [];
  for (const pattern of PATTERNS) {
    for await (const entry of glob(pattern, { cwd: root })) {
      const file = entry.split(path.sep).join('/');
      if (exportsAdapter(file, await readFile(path.join(root, file), 'utf8'))) breaches.push(file);
    }
  }
  return breaches.sort();
}

describe('no-adapter-export', () => {
  it('flags an index exporting from adapter/, relative or aliased, and not a clean one', async () => {
    expect(await findAdapterExports(FIXTURE_ROOT)).toEqual([
      'apps/admin-console/src/features/alpha/index.ts',
      'apps/docs/src/features/beta/index.ts',
    ]);
  });

  it('has no slice index exporting an adapter outside the inventory', async () => {
    const found = await findAdapterExports(REPO_ROOT);
    expect(checkRule('no-adapter-export', found).errors).toEqual([]);
  });
});
