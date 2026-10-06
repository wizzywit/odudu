import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientOriginsCommand, rebuildClientOrigins } from '#/cli/client-origins';
import { seed } from '#/cli/seed';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  app = createDatabase(appUrl, { max: 5 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = Buffer.alloc(32, 7).toString('base64');
}, 120_000);

afterAll(async () => {
  Reflect.deleteProperty(process.env, 'ODUDU_DATABASE_URL');
  Reflect.deleteProperty(process.env, 'ODUDU_APP_DATABASE_URL');
  Reflect.deleteProperty(process.env, 'ODUDU_KEK');
  await app.close();
  await owner.close();
  await container.stop();
});

// A row as a release before the table left it: lists the backfill declines,
// and no origins.
async function legacyClient(webOrigins: string[], redirectUris: string[]): Promise<string> {
  const result = await seed(['tenant', '--name', `origins-${newId()}`]);
  if (result.command !== 'tenant') throw new Error('expected the tenant command');
  const id = newId();
  await owner.sql`
    insert into clients (id, tenant_id, client_id, name, type)
    values (${id}, ${result.tenantId}, ${`legacy-${id}`}, 'Legacy', 'public')`;
  await owner.sql`
    insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types,
                                    token_endpoint_auth_method, web_origins)
    values (${id}, ${result.tenantId}, ${redirectUris}::text[], '{authorization_code}',
            'none', ${webOrigins}::text[])`;
  return id;
}

async function originsOf(clientId: string): Promise<string[]> {
  const rows = await owner.sql<{ origin: string }[]>`
    select origin from client_origins where client_id = ${clientId} order by origin`;
  return rows.map((row) => row.origin);
}

describe('odudu client-origins rebuild', () => {
  it('gives a legacy row the origins the server would have written', async () => {
    const idn = await legacyClient(['https://münchen.example'], ['https://app.example/cb']);
    const ipv6 = await legacyClient(['https://[::1]:3000'], ['https://app.example/cb']);
    const padded = await legacyClient(['https://a.example:0443'], ['https://app.example/cb']);
    const derived = await legacyClient(['+'], ['https://spa.example:8443/cb', 'myapp:/cb']);
    for (const id of [idn, ipv6, padded, derived]) expect(await originsOf(id)).toEqual([]);

    const outcome = await rebuildClientOrigins({ database: app, ownerDatabase: owner });

    expect(outcome.clients).toBeGreaterThanOrEqual(4);
    expect(await originsOf(idn)).toEqual(['https://xn--mnchen-3ya.example']);
    expect(await originsOf(ipv6)).toEqual(['https://[::1]:3000']);
    expect(await originsOf(padded)).toEqual(['https://a.example']);
    expect(await originsOf(derived)).toEqual(['https://spa.example:8443']);
  });

  it('is repeatable, and runs as the command with its one subcommand', async () => {
    const id = await legacyClient(['https://again.example'], ['https://app.example/cb']);
    const first = await clientOriginsCommand(['rebuild']);
    const second = await clientOriginsCommand(['rebuild']);
    expect(first).toMatch(/^rebuilt the origins of \d+ clients$/u);
    expect(second).toBe(first);
    expect(await originsOf(id)).toEqual(['https://again.example']);
    await expect(clientOriginsCommand(['nope'])).rejects.toThrow(/rebuild/u);
  });
});
