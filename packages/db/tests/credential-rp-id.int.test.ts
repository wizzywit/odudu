import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { stampPasskeyRelyingParty } from '#/credential-rp-id';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';

let container: TestDatabase;
let owner: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  await owner.close();
  await container.stop();
});

async function credential(type: string, rpId: string | null): Promise<string> {
  const tenantId = newId();
  const subjectId = newId();
  const id = newId();
  await owner.sql`insert into tenants (id, name) values (${tenantId}, ${`t-${tenantId.slice(-12)}`})`;
  await owner.sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'user')`;
  await owner.sql`
    insert into user_credentials (id, tenant_id, subject_id, type, secret_data, rp_id)
    values (${id}, ${tenantId}, ${subjectId}, ${type}, '{}'::jsonb, ${rpId})`;
  return id;
}

async function rpIdOf(id: string): Promise<string | null> {
  const rows = await owner.sql<{ rp_id: string | null }[]>`
    select rp_id from user_credentials where id = ${id}`;
  return rows[0]?.rp_id ?? null;
}

describe('stampPasskeyRelyingParty', () => {
  it('stamps passkeys with no id, in every tenant, and nothing else', async () => {
    const passkeyA = await credential('webauthn', null);
    const passkeyB = await credential('webauthn', null);
    const registered = await credential('webauthn', 'login.acme.com');
    const password = await credential('password', null);

    const stamped = await stampPasskeyRelyingParty(owner.db, 'idp.example.com');

    expect(stamped).toBeGreaterThanOrEqual(2);
    expect(await rpIdOf(passkeyA)).toBe('idp.example.com');
    expect(await rpIdOf(passkeyB)).toBe('idp.example.com');
    expect(await rpIdOf(registered)).toBe('login.acme.com');
    expect(await rpIdOf(password)).toBeNull();
  });

  it('has nothing left to stamp the second time', async () => {
    await credential('webauthn', null);
    expect(await stampPasskeyRelyingParty(owner.db, 'idp.example.com')).toBe(1);
    expect(await stampPasskeyRelyingParty(owner.db, 'idp.example.com')).toBe(0);
  });
});
