import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// zod probes `new Function` whenever a schema is built unless it is told to
// run jitless, and the console's CSP reports that probe as a violation. The
// switch lives in zod's module-level config, so it only reaches
// @odudu/contracts' schemas if there is one zod, and only in time if it runs
// before any module that builds one: the entry's first import.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

function zodPin(packageJson: string): unknown {
  const parsed: unknown = JSON.parse(read(packageJson));
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { dependencies, devDependencies } = parsed as Record<string, unknown>;
  const all = { ...(dependencies as object), ...(devDependencies as object) };
  return (all as Record<string, unknown>).zod;
}

// The entry's first statement, since an `export … from` above it is
// evaluated first too.
function firstImportsZodConfig(source: string): boolean {
  const file = ts.createSourceFile('main.tsx', source, ts.ScriptTarget.Latest, true);
  const [first] = file.statements;
  return (
    first !== undefined &&
    ts.isImportDeclaration(first) &&
    first.importClause === undefined &&
    first.moduleSpecifier.getText().slice(1, -1) === '#/zodConfig.ts'
  );
}

describe("the console's zod", () => {
  it('is configured by the first module the entry imports', () => {
    expect(firstImportsZodConfig(read('apps/admin-console/src/main.tsx'))).toBe(true);
  });

  it.each([
    ["export { App } from '#/app/App.tsx';\nimport '#/zodConfig.ts';\n"],
    ["import { App } from '#/app/App.tsx';\nimport '#/zodConfig.ts';\n"],
    ["import { z } from '#/zodConfig.ts';\n"],
  ])('refuses an entry that evaluates another module first: %j', (source) => {
    expect(firstImportsZodConfig(source)).toBe(false);
  });

  it("is pinned to the contracts' version", () => {
    const pin = zodPin('packages/contracts/package.json');
    expect(typeof pin).toBe('string');
    expect(zodPin('apps/admin-console/package.json')).toBe(pin);
  });

  it('is the only zod the lockfile resolves', () => {
    const versions = new Set(
      [...read('pnpm-lock.yaml').matchAll(/^ {2}zod@([^:(]+)/gmu)].map((m) => m[1]),
    );
    expect([...versions]).toEqual([zodPin('packages/contracts/package.json')]);
  });
});
