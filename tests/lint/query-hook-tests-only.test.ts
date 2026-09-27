import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// `createDatabase`'s statement hook hands every statement's parameters to
// its caller, and those carry password hashes, secret hashes, emails and
// TOTP seeds. A test may read them; production code never sets the hook,
// so a caller that logs what it sees cannot ship.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE_TREES = ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts', 'tools/*/src/**/*.ts'];
const DECLARED_IN = 'packages/db/src/client.ts';
const HOOK = /\bonQuery\w*/u;

describe('the statement hook createDatabase offers', { timeout: 60_000 }, () => {
  it('is named for tests', async () => {
    const source = await readFile(path.join(REPO_ROOT, DECLARED_IN), 'utf8');
    expect(source).toMatch(/\bonQueryForTests\?:/u);
  });

  it('is set by no source file outside a test', async () => {
    const offenders: string[] = [];
    for (const pattern of SOURCE_TREES) {
      for await (const file of glob(pattern, { cwd: REPO_ROOT })) {
        if (file.endsWith('.test.ts') || file === DECLARED_IN) continue;
        const source = await readFile(path.join(REPO_ROOT, file), 'utf8');
        if (HOOK.test(source)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
