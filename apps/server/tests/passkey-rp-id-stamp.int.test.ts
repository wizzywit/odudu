import { createDatabase, type DatabaseHandle } from '@odudu/db';
import { FakeClock, loadConfig, newId, type Logger } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseModule } from '#/modules/database';

let container: TestDatabase;
let owner: DatabaseHandle;

const quiet: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quiet,
};

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
}, 120_000);

afterAll(async () => {
  await owner.close();
  await container.stop();
});

function start(base: string | undefined): Promise<void> {
  const config = loadConfig({
    ODUDU_DATABASE_URL: container.adminUrl,
    ODUDU_KEK: Buffer.alloc(32, 3).toString('base64'),
    ...(base === undefined ? {} : { ODUDU_PUBLIC_BASE_URL: base }),
  });
  const module = databaseModule(owner, owner);
  return (
    module.start?.({ config, clock: new FakeClock(new Date()), logger: quiet }) ?? Promise.resolve()
  );
}

async function passkey(): Promise<string> {
  const tenantId = newId();
  const subjectId = newId();
  const id = newId();
  await owner.sql`insert into tenants (id, name) values (${tenantId}, ${`t-${tenantId.slice(-12)}`})`;
  await owner.sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'user')`;
  await owner.sql`
    insert into user_credentials (id, tenant_id, subject_id, type, secret_data)
    values (${id}, ${tenantId}, ${subjectId}, 'webauthn', '{}'::jsonb)`;
  return id;
}

async function rpIdOf(id: string): Promise<string | null> {
  const rows = await owner.sql<{ rp_id: string | null }[]>`
    select rp_id from user_credentials where id = ${id}`;
  return rows[0]?.rp_id ?? null;
}

describe('the database module at start', () => {
  it('leaves a passkey with no relying party id when no base URL is configured', async () => {
    await start(undefined);
    const id = await passkey();
    await start(undefined);
    expect(await rpIdOf(id)).toBeNull();
  });

  it('leaves it alone when the base URL is an address literal', async () => {
    const id = await passkey();
    await start('http://127.0.0.1:3000');
    expect(await rpIdOf(id)).toBeNull();
  });

  it('stamps it with the base host once a base URL is configured', async () => {
    const id = await passkey();
    await start('https://idp.example.com');
    expect(await rpIdOf(id)).toBe('idp.example.com');
  });
});
