import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The console's build, as the image serves it. zod must run jitless before
// any schema is built, and once features are split into chunks the entry's
// first import no longer guarantees that: a chunk shared by two features is
// evaluated before the entry's own body. What does guarantee it is one chunk
// holding zod and the setting, importing nothing, which every chunk that
// builds a schema imports and so evaluates after (vite.config.ts).

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const ASSETS = path.join(REPO_ROOT, 'apps/admin-console/dist/assets');
const ZOD_CONFIG = path.join(REPO_ROOT, 'apps/admin-console/src/zodConfig.ts');
// zod keeps its configuration on this global, in its own module alone.
const ZOD_MARKER = '__zod_globalConfig';
const JITLESS = 'jitless:!0';

function chunks(): { readonly name: string; readonly text: string }[] {
  if (!existsSync(ASSETS)) {
    throw new Error(
      'apps/admin-console/dist is missing: run the build first (pnpm verify builds it before testing)',
    );
  }
  return readdirSync(ASSETS)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, text: readFileSync(path.join(ASSETS, name), 'utf8') }));
}

function importSpecifiers(text: string): string[] {
  return [...text.matchAll(/(?:from|import)\s*\(?\s*"(\.\/[^"]+)"/gu)].map(
    (match) => match[1] ?? '',
  );
}

describe("the console's built zod", () => {
  it('sits with its jitless setting in one chunk that imports nothing', () => {
    const all = chunks();
    const holding = all.filter((chunk) => chunk.text.includes(ZOD_MARKER));
    const configured = all.filter((chunk) => chunk.text.includes(JITLESS));
    expect(
      holding.map((chunk) => chunk.name),
      'chunks holding zod',
    ).toHaveLength(1);
    expect(
      configured.map((chunk) => chunk.name),
      'chunks setting jitless',
    ).toEqual(holding.map((chunk) => chunk.name));
    const [zod] = holding;
    expect(zod === undefined ? ['(none)'] : importSpecifiers(zod.text), zod?.name).toEqual([]);
  });

  it('sets jitless as the chunk ends, after all of zod is defined and before anything uses it', () => {
    const zod = chunks().find((chunk) => chunk.text.includes(ZOD_MARKER));
    expect(zod?.text.trimEnd()).toMatch(/[;}]\w+\(\{jitless:!0\}\);export\{[^}]*\};?$/u);
  });

  it('is imported by the entry, so no chunk runs before it', () => {
    const all = chunks();
    const zod = all.find((chunk) => chunk.text.includes(ZOD_MARKER));
    const entry = all.find((chunk) => chunk.name.startsWith('index-'));
    expect(entry === undefined ? [] : importSpecifiers(entry.text)).toContain(
      `./${zod?.name ?? ''}`,
    );
  });

  it('is configured by a module that imports zod and nothing else', () => {
    const source = ts.createSourceFile(
      'zodConfig.ts',
      readFileSync(ZOD_CONFIG, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = source.statements
      .filter(ts.isImportDeclaration)
      .map((statement) => statement.moduleSpecifier.getText().slice(1, -1));
    expect(imports).toEqual(['zod']);
  });
});
