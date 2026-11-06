import { provisionTenant } from '@odudu/authn-flows';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dynamicClientRepository } from '#/repository/dynamic-clients';

let container: TestDatabase | undefined;
let owner: DatabaseHandle | undefined;
let app: DatabaseHandle | undefined;

const NOW = new Date('2026-11-05T12:00:00.000Z');
const LATER = '2026-11-05T13:00:00.000Z';
const EARLIER = '2026-11-05T11:00:00.000Z';

function sql() {
  if (owner === undefined) throw new Error('not started');
  return owner.sql;
}

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await container?.stop();
});

async function tenant(): Promise<{ id: string; subject: string }> {
  const id = newId();
  if (app === undefined) throw new Error('not started');
  await withTenant(app.db, id, async (tx) => {
    await tx.insert(tenants).values({ id, name: `t-${id}` });
    await provisionTenant(tx, id);
  });
  const subject = newId();
  await sql()`insert into subjects (id, tenant_id, type) values (${subject}, ${id}, 'user')`;
  return { id, subject };
}

async function client(tenantId: string, name: string, secondsAgo: number): Promise<string> {
  const id = newId();
  await sql()`
    insert into clients (id, tenant_id, client_id, name, type, secret_hash,
                         registration_origin, created_at)
    values (${id}, ${tenantId}, ${name}, ${name}, 'public', null, 'anonymous',
            ${NOW.toISOString()}::timestamptz - make_interval(secs => ${secondsAgo}))`;
  return id;
}

function evictable(tenantId: string, asTenant = tenantId): Promise<string | null> {
  if (app === undefined) throw new Error('not started');
  return withTenant(app.db, asTenant, (tx) => dynamicClientRepository(tx).evictable(tenantId, NOW));
}

describe('dynamicClientRepository.evictable', () => {
  it('offers the oldest self-registered client that never did anything', async () => {
    const t = await tenant();
    await client(t.id, 'newer', 10);
    const oldest = await client(t.id, 'older', 100);
    expect(await evictable(t.id)).toBe(oldest);
  });

  it('passes over a client with an approval, a consent, a grant, a live code or a live sign-in', async () => {
    const t = await tenant();
    const approved = await client(t.id, 'approved', 900);
    await sql()`update clients set approved_at = now() where id = ${approved}`;
    const consented = await client(t.id, 'consented', 800);
    await sql()`insert into consents (id, tenant_id, subject_id, client_id)
      values (${newId()}, ${t.id}, ${t.subject}, ${consented})`;
    const granted = await client(t.id, 'granted', 700);
    await sql()`insert into token_grants (id, tenant_id, client_id, subject_id, scope)
      values (${newId()}, ${t.id}, ${granted}, ${t.subject}, 'openid')`;
    const coded = await client(t.id, 'coded', 600);
    await sql()`insert into authorization_codes
      (code_hash, tenant_id, client_id, subject_id, redirect_uri, scope, code_challenge,
       code_challenge_method, auth_time, expires_at)
      values (${newId()}, ${t.id}, ${coded}, ${t.subject}, 'https://a.example/cb', 'openid', 'c',
              'S256', ${EARLIER}, ${LATER})`;
    await client(t.id, 'pending', 500);
    await sql()`insert into authentication_sessions (id, tenant_id, pending_request, expires_at)
      values (${newId()}, ${t.id}, ${JSON.stringify({ clientId: 'pending' })}::jsonb, ${LATER})`;
    const free = await client(t.id, 'free', 10);
    expect(await evictable(t.id)).toBe(free);
  });

  it('passes over a client an administrator disabled', async () => {
    const t = await tenant();
    const off = await client(t.id, 'off', 100);
    await sql()`update clients set enabled = false where id = ${off}`;
    expect(await evictable(t.id)).toBeNull();
  });

  it('finds nothing of another tenant through a foreign tenant context', async () => {
    const mine = await tenant();
    const theirs = await tenant();
    await client(mine.id, 'mine', 100);
    expect(await evictable(mine.id, theirs.id)).toBeNull();
  });
});
