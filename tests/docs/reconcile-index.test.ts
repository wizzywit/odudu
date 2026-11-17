import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './markdown.js';

// The statement is run against the real schema by the integration test that
// holds it; each document that tells an operator about it quotes the same one,
// and the migration that builds it is in the journal.
const TEST = 'packages/protocol-admin/tests/reconcile-accounts.int.test.ts';
const DOCUMENTS = ['docs/phases/p4f.md', 'RELEASING.md'];

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

describe('the unique address index', () => {
  const statement = /'(CREATE UNIQUE INDEX users_email_search_unique[^']*)'/u.exec(read(TEST))?.[1];

  it('is found in the integration test', () => {
    expect(statement).toMatch(/^CREATE UNIQUE INDEX users_email_search_unique ON users /u);
  });

  it.each(DOCUMENTS)('is quoted as it runs in %s', (file) => {
    expect(read(file)).toContain(statement ?? 'no statement found');
  });

  it('is built by a migration in the journal, over the same columns and predicate', () => {
    expect(read('packages/db/drizzle/meta/_journal.json')).toContain('0139_users_email_unique');
    const sql = read('packages/db/drizzle/0139_users_email_unique.sql');
    expect(sql).toContain('users_email_search_unique');
    expect(sql).toMatch(/ON users \(tenant_id, email_search\) WHERE email_search IS NOT NULL/u);
  });

  it('is checked after the migrations by a test that fails if it is dropped', () => {
    expect(read('packages/db/tests/email-unique-index.int.test.ts')).toContain(
      'the index was dropped or never built',
    );
  });
});
