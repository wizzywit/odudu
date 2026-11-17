import { actionTokenRepository, peekActionToken } from '@odudu/account';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findReturnClient } from '#/return-client';

const URI = 'https://app.example/after';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

async function tenantWithClient(): Promise<{ tenantId: string; clientDbId: string }> {
  const tenantId = newId();
  const clientDbId = newId();
  await owner.sql`insert into tenants (id, name) values (${tenantId}, ${`rc-${tenantId}`})`;
  await owner.sql`insert into clients (id, tenant_id, client_id, name, type)
    values (${clientDbId}, ${tenantId}, 'app', 'App', 'public')`;
  await owner.sql`insert into client_oidc_config
      (client_id, tenant_id, redirect_uris, grant_types, token_endpoint_auth_method)
    values (${clientDbId}, ${tenantId}, ARRAY[${URI}], ARRAY['authorization_code'], 'none')`;
  return { tenantId, clientDbId };
}

async function peekReturn(
  tenantId: string,
  subjectId: string,
  client: string,
): Promise<string | null | undefined> {
  const { token } = await withTenant(app.db, tenantId, (tx) =>
    actionTokenRepository(tx).issue({
      tenantId,
      subjectId,
      type: 'verify_email',
      returnTo: { clientId: client, uri: URI },
      ttlSeconds: 600,
    }),
  );
  const peeked = await peekActionToken({ database: app, tenantId, findReturnClient }, token);
  return peeked.kind === 'usable' ? peeked.returnTo : undefined;
}

async function subjectIn(tenantId: string): Promise<string> {
  const id = newId();
  await owner.db.execute(
    sql`insert into subjects (id, tenant_id, type) values (${id}, ${tenantId}, 'user')`,
  );
  return id;
}

describe('findReturnClient through the real wiring', () => {
  it('gives the way back for the tenant’s own enabled client', async () => {
    const a = await tenantWithClient();
    expect(await peekReturn(a.tenantId, await subjectIn(a.tenantId), a.clientDbId)).toBe(URI);
  });

  it('gives none for a client of another tenant', async () => {
    const a = await tenantWithClient();
    const b = await tenantWithClient();
    expect(await peekReturn(a.tenantId, await subjectIn(a.tenantId), b.clientDbId)).toBeNull();
  });

  it('gives none once the client is disabled or stops registering the address', async () => {
    const off = await tenantWithClient();
    await owner.sql`update clients set enabled = false where id = ${off.clientDbId}`;
    expect(
      await peekReturn(off.tenantId, await subjectIn(off.tenantId), off.clientDbId),
    ).toBeNull();

    const moved = await tenantWithClient();
    await owner.sql`update client_oidc_config set redirect_uris = ARRAY['https://app.example/else']
      where client_id = ${moved.clientDbId}`;
    expect(
      await peekReturn(moved.tenantId, await subjectIn(moved.tenantId), moved.clientDbId),
    ).toBeNull();
  });
});
