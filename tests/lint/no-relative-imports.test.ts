import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('no-restricted-imports for relative paths', { timeout: 60_000 }, () => {
  it('rejects a relative import in package source', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const results = await eslint.lintText("import { KERNEL_VERSION } from './version.js';\n", {
      filePath: 'packages/kernel/src/index.ts',
    });
    const [result] = results;
    if (!result) throw new Error('expected a lint result');
    const messages = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
    expect(messages.length).toBeGreaterThan(0);
  });

  it('rejects a relative import in a component file', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const results = await eslint.lintText("export { App } from './App.tsx';\n", {
      filePath: 'apps/admin-console/src/app/router.tsx',
    });
    const [result] = results;
    if (!result) throw new Error('expected a lint result');
    const messages = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
    expect(messages.length).toBeGreaterThan(0);
  });

  const flagged = ['.', '..', './version.js', '../foo.js', '../../foo.js'];
  const allowed = ['zod', 'node:url', '@odudu/kernel', '#/version'];

  for (const specifier of flagged) {
    it(`rejects specifier ${JSON.stringify(specifier)}`, async () => {
      const eslint = new ESLint({ cwd: REPO_ROOT });
      const results = await eslint.lintText(`import { x } from '${specifier}';\n`, {
        filePath: 'packages/kernel/src/index.ts',
      });
      const [result] = results;
      if (!result) throw new Error('expected a lint result');
      const messages = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
      expect(messages.length).toBeGreaterThan(0);
    });
  }

  for (const specifier of allowed) {
    it(`allows specifier ${JSON.stringify(specifier)}`, async () => {
      const eslint = new ESLint({ cwd: REPO_ROOT });
      const results = await eslint.lintText(`import { x } from '${specifier}';\n`, {
        filePath: 'packages/kernel/src/index.ts',
      });
      const [result] = results;
      if (!result) throw new Error('expected a lint result');
      const messages = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
      expect(messages.length).toBe(0);
    });
  }
});
