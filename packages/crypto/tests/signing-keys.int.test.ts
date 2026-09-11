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
import { signingKeyRepository } from '#/repository/signing-keys';
import { signingKeys } from '#/schema/signing-keys';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const PUBLIC_JWK = { kty: 'RSA', n: 'n-value', e: 'AQAB' };
const PRIVATE_ENCRYPTED = 'ciphertext-placeholder';

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

async function insertKey(
  tx: RealmScopedDatabase,
  realmId: string,
  overrides: Partial<typeof signingKeys.$inferInsert> = {},
): Promise<void> {
  await tx.insert(signingKeys).values({
    id: newId(),
    realmId,
    kid: newId(),
    alg: 'RS256',
    status: 'active',
    publicJwk: PUBLIC_JWK,
    privateJwkEncrypted: PRIVATE_ENCRYPTED,
    ...overrides,
  });
}

describe('signingKeyRepository', () => {
  it('round-trips a key through the repository', async () => {
    const realmId = newId();
    const kid = newId();

    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      await insertKey(tx, realmId, { kid });
    });

    const active = await withRealm(app.db, realmId, async (tx) =>
      signingKeyRepository(tx).active(),
    );

    expect(active.kid).toBe(kid);
    expect(active.alg).toBe('RS256');
    expect(active.status).toBe('active');
    expect(active.publicJwk).toEqual(PUBLIC_JWK);
    expect(active.privateJwkEncrypted).toBe(PRIVATE_ENCRYPTED);
    expect(active.notAfter).toBeNull();
  });

  it('excludes retired keys from the published set', async () => {
    const realmId = newId();

    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      await insertKey(tx, realmId, { kid: 'active-kid', status: 'active' });
      await insertKey(tx, realmId, { kid: 'rotating-kid', status: 'rotating' });
      await insertKey(tx, realmId, { kid: 'retired-kid', status: 'retired' });
    });

    const published = await withRealm(app.db, realmId, async (tx) =>
      signingKeyRepository(tx).listPublishable(),
    );

    expect(published.map((k) => k.kid)).toEqual(['active-kid', 'rotating-kid']);
  });

  it('refuses a second active key in one realm', async () => {
    const realmId = newId();

    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      await insertKey(tx, realmId, { status: 'active' });
    });

    // Drizzle wraps the driver error as `DrizzleQueryError`, whose own
    // .message is just "Failed query: ...<sql>..." — the postgres error text
    // (and the constraint name) lives on .cause, which `toThrow` never
    // inspects.
    let error: unknown;
    try {
      await withRealm(app.db, realmId, async (tx) => insertKey(tx, realmId, { status: 'active' }));
      expect.unreachable('expected the second active insert to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('signing_keys_one_active');
  });

  it('allows a second key when the first is not active', async () => {
    const realmId = newId();

    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      await insertKey(tx, realmId, { status: 'rotating' });
      await insertKey(tx, realmId, { status: 'active' });
    });

    const active = await withRealm(app.db, realmId, async (tx) =>
      signingKeyRepository(tx).active(),
    );
    expect(active.status).toBe('active');
  });

  it('isolates keys by realm', async () => {
    await expectRealmIsolation(app.db, {
      table: 'signing_keys',
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        await insertKey(tx, realmId);
      },
    });
  });
});
