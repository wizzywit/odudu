import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectRealmIsolation } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientRepository } from '#/repository/clients';
import { clients } from '#/schema/clients';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function seedRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
}

async function insertClient(
  tx: RealmScopedDatabase,
  realmId: string,
  overrides: Partial<typeof clients.$inferInsert> = {},
): Promise<void> {
  await tx.insert(clients).values({
    id: newId(),
    realmId,
    clientId: `client-${newId()}`,
    name: 'A client',
    type: 'confidential',
    secretHash: 'hashed:secret',
    ...overrides,
  });
}

describe('clientRepository', () => {
  it('finds a client by its client_id', async () => {
    const realmId = newId();
    const clientId = `web-app-${newId()}`;

    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      await insertClient(tx, realmId, { clientId });
    });

    const found = await withRealm(app.db, realmId, async (tx) =>
      clientRepository(tx).byClientId(clientId),
    );

    expect(found).not.toBeNull();
    expect(found?.clientId).toBe(clientId);
    expect(found?.type).toBe('confidential');
  });

  it('returns null when no client matches', async () => {
    const realmId = newId();

    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
    });

    const found = await withRealm(app.db, realmId, async (tx) =>
      clientRepository(tx).byClientId('does-not-exist'),
    );

    expect(found).toBeNull();
  });

  it('creates a client through the repository', async () => {
    const realmId = newId();
    const clientId = `created-${newId()}`;

    const created = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      return clientRepository(tx).create({
        realmId,
        clientId,
        name: 'Created client',
        type: 'public',
        secretHash: null,
      });
    });

    expect(created.clientId).toBe(clientId);
    expect(created.type).toBe('public');
    expect(created.secretHash).toBeNull();
    expect(created.id).not.toBe('');

    const found = await withRealm(app.db, realmId, async (tx) =>
      clientRepository(tx).byClientId(clientId),
    );
    expect(found?.id).toBe(created.id);
  });

  it('rejects a second client with the same client_id in one realm', async () => {
    const realmId = newId();
    const clientId = `dup-${newId()}`;

    let error: unknown;
    try {
      await withRealm(app.db, realmId, async (tx) => {
        await seedRealm(tx, realmId);
        await insertClient(tx, realmId, { clientId });
        await insertClient(tx, realmId, { clientId });
      });
      expect.unreachable('expected the duplicate client_id insert to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('clients_client_id_unique');
  });

  it('rejects a public client carrying a secret', async () => {
    const realmId = newId();

    let error: unknown;
    try {
      await withRealm(app.db, realmId, async (tx) => {
        await seedRealm(tx, realmId);
        await insertClient(tx, realmId, { type: 'public', secretHash: 'x' });
      });
      expect.unreachable('expected the public client with a secret to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('clients_secret_matches_type');
  });

  it('isolates clients by realm', async () => {
    await expectRealmIsolation(app.db, {
      table: 'clients',
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        await insertClient(tx, realmId);
      },
    });
  });
});
