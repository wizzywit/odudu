import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('no-restricted-imports for relative paths', () => {
  it('rejects a relative import in package source', async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const results = await eslint.lintText("import { KERNEL_VERSION } from './version.js';\n", {
      filePath: 'packages/kernel/src/index.ts',
    });
    const [result] = results;
    if (!result) throw new Error('expected a lint result');
    const messages = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
    expect(messages.length).toBeGreaterThan(0);
  });
});
