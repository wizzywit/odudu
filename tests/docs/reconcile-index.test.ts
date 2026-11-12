import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './markdown.js';

// The statement is run against the real schema by the integration test that
// holds it; each document that tells an operator to wait for it quotes the
// same one.
const TEST = 'packages/protocol-admin/tests/reconcile-accounts.int.test.ts';
const DOCUMENTS = ['docs/phases/p4f.md', 'RELEASING.md'];

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

describe('the unique address index held back to a later release', () => {
  const statement = /'(CREATE UNIQUE INDEX users_email_search_unique[^']*)'/u.exec(read(TEST))?.[1];

  it('is found in the integration test', () => {
    expect(statement).toMatch(/^CREATE UNIQUE INDEX users_email_search_unique ON users /u);
  });

  it.each(DOCUMENTS)('is quoted as it runs in %s', (file) => {
    expect(read(file)).toContain(statement ?? 'no statement found');
  });

  it('is not a migration yet, so the command can run first', () => {
    const migrations = readFileSync(
      path.join(REPO_ROOT, 'packages/db/drizzle/meta/_journal.json'),
      'utf8',
    );
    expect(migrations).not.toContain('users_email_search_unique');
  });
});
