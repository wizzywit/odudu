import { signingKeys } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { subjects } from '@odudu/domain-identity';
import { clients } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed, type SeedOptions } from '#/cli/seed';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);

  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = Buffer.alloc(32, 7).toString('base64');
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await ownerHandle?.close();
  await containerHandle?.stop();
});

// Every helper below scopes by realmId: the owner connection bypasses RLS
// entirely, and each test seeds its own realm, so an unscoped count would
// pick up every realm this file has already seeded rather than just the
// one under test.
async function countClients(realmId: string): Promise<number> {
  const rows = await owner.db.select().from(clients).where(eq(clients.realmId, realmId));
  return rows.length;
}

async function countSigningKeys(realmId: string): Promise<number> {
  const rows = await owner.db.select().from(signingKeys).where(eq(signingKeys.realmId, realmId));
  return rows.length;
}

async function clientType(realmId: string, clientId: string): Promise<string> {
  const rows = await owner.db
    .select({ type: clients.type })
    .from(clients)
    .where(and(eq(clients.realmId, realmId), eq(clients.clientId, clientId)));
  const row = rows[0];
  if (row === undefined) throw new Error(`no client ${clientId} in realm ${realmId}`);
  return row.type;
}

async function serviceSubjectType(realmId: string, clientId: string): Promise<string | null> {
  const clientRows = await owner.db
    .select({ serviceSubjectId: clients.serviceSubjectId })
    .from(clients)
    .where(and(eq(clients.realmId, realmId), eq(clients.clientId, clientId)));
  const clientRow = clientRows[0];
  if (clientRow === undefined) throw new Error(`no client ${clientId} in realm ${realmId}`);
  if (clientRow.serviceSubjectId === null) return null;

  const subjectRows = await owner.db
    .select({ type: subjects.type })
    .from(subjects)
    .where(eq(subjects.id, clientRow.serviceSubjectId));
  const subjectRow = subjectRows[0];
  if (subjectRow === undefined) throw new Error(`no subject ${clientRow.serviceSubjectId}`);
  return subjectRow.type;
}

function uniqueOptions(): SeedOptions {
  const suffix = newId();
  return {
    realm: `acme-${suffix}`,
    clientId: 'web-app',
    clientSecret: 's3cret',
    redirectUris: ['https://app.example/callback'],
    username: 'ada',
    password: 'pw',
  };
}

describe('seed', () => {
  it('creates a realm, a client, a user and a signing key', async () => {
    const options = uniqueOptions();

    const result = await seed(options);

    expect(result).toMatchObject({ created: true, realm: options.realm, clientId: 'web-app' });
    expect(await countSigningKeys(result.realmId)).toBe(1);
  });

  it('is idempotent: running twice does not duplicate or fail', async () => {
    const options = uniqueOptions();

    const first = await seed(options);
    await expect(seed(options)).resolves.toMatchObject({ created: false });
    expect(await countClients(first.realmId)).toBe(1);
    expect(await countSigningKeys(first.realmId)).toBe(1);
  });

  it('creates a public client when no secret is given', async () => {
    const options = uniqueOptions();
    const publicOptions: SeedOptions = {
      realm: options.realm,
      clientId: options.clientId,
      redirectUris: options.redirectUris,
      username: 'ada',
      password: 'pw',
    };

    const result = await seed(publicOptions);

    expect(await clientType(result.realmId, result.clientId)).toBe('public');
  });

  it('refuses a redirect URI that is not absolute', async () => {
    const options = uniqueOptions();

    await expect(seed({ ...options, redirectUris: ['/callback'] })).rejects.toThrow(/absolute/);
  });

  it('refuses a second run with a different client secret for the same client', async () => {
    const options = uniqueOptions();

    await seed(options);

    await expect(seed({ ...options, clientSecret: 'different' })).rejects.toThrow(
      /different client secret/,
    );
  });

  it('refuses a second run with different redirect URIs for the same client', async () => {
    const options = uniqueOptions();

    await seed(options);

    await expect(
      seed({ ...options, redirectUris: ['https://app.example/other-callback'] }),
    ).rejects.toThrow(/different redirect URIs/);
  });

  it('refuses a --user naming someone not seeded on an already-existing client, rather than silently doing nothing', async () => {
    const options = uniqueOptions();

    await seed(options);

    await expect(seed({ ...options, username: 'grace', password: 'pw' })).rejects.toThrow(/grace/);
  });
});

describe('seed: service-account subject', () => {
  it('links a confidential client to a service-account subject', async () => {
    const options = uniqueOptions();

    const result = await seed(options);

    expect(await serviceSubjectType(result.realmId, result.clientId)).toBe('service');
  });

  it('creates a public client with no service-account subject', async () => {
    const options = uniqueOptions();
    const publicOptions: SeedOptions = {
      realm: options.realm,
      clientId: options.clientId,
      redirectUris: options.redirectUris,
      username: 'ada',
      password: 'pw',
    };

    const result = await seed(publicOptions);

    expect(await serviceSubjectType(result.realmId, result.clientId)).toBeNull();
  });
});
