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

describe("the console's zod", () => {
  it('is configured by the first module the entry imports', () => {
    const entry = 'apps/admin-console/src/main.tsx';
    const file = ts.createSourceFile(entry, read(entry), ts.ScriptTarget.Latest, true);
    const [first] = file.statements.filter(ts.isImportDeclaration);
    expect(first?.moduleSpecifier.getText().slice(1, -1)).toBe('#/zodConfig.ts');
    expect(first?.importClause).toBeUndefined();
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
