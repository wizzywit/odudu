import { subjectRepository } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectCrossRealmMethodProbe } from '@odudu/db/testing';
import { clients } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenGrantRepository, type TokenGrantRecord } from '#/repository/grants';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const AUDIENCE = ['https://api.example'];

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

async function seedRealmClientSubject(
  tx: RealmScopedDatabase,
  realmId: string,
): Promise<{ clientDbId: string; subjectId: string }> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
  const clientDbId = newId();
  await tx.insert(clients).values({
    id: clientDbId,
    realmId,
    clientId: `client-${realmId}`,
    name: 'A client',
    type: 'confidential',
    secretHash: 'hashed:secret',
  });
  const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
  return { clientDbId, subjectId: subject.id };
}

async function createGrant(tx: RealmScopedDatabase, realmId: string): Promise<TokenGrantRecord> {
  const { clientDbId, subjectId } = await seedRealmClientSubject(tx, realmId);
  return tokenGrantRepository(tx).create({
    realmId,
    clientId: clientDbId,
    subjectId,
    scope: 'openid',
    audience: AUDIENCE,
  });
}

describe('tokenGrantRepository', () => {
  it('creates and finds a grant by id', async () => {
    const realmId = newId();

    const created = await withRealm(app.db, realmId, (tx) => createGrant(tx, realmId));

    const found = await withRealm(app.db, realmId, (tx) =>
      tokenGrantRepository(tx).byId(created.id),
    );
    expect(found?.id).toBe(created.id);
    expect(found?.revokedAt).toBeNull();
  });

  it('revokes a grant', async () => {
    const realmId = newId();
    const created = await withRealm(app.db, realmId, (tx) => createGrant(tx, realmId));

    await withRealm(app.db, realmId, (tx) =>
      tokenGrantRepository(tx).revoke(created.id, new Date()),
    );

    const found = await withRealm(app.db, realmId, (tx) =>
      tokenGrantRepository(tx).byId(created.id),
    );
    expect(found?.revokedAt).not.toBeNull();
  });

  it('cannot find a grant by id under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => createGrant(tx, realmId),
      verifySeeded: async (tx, grant) => {
        const found = await tokenGrantRepository(tx).byId(grant.id);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, grant) => tokenGrantRepository(tx).byId(grant.id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('leaves a grant unrevoked when revoke is called under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => createGrant(tx, realmId),
      verifySeeded: async (tx, grant) => {
        const found = await tokenGrantRepository(tx).byId(grant.id);
        expect(found?.revokedAt).toBeNull();
      },
      attempt: async (tx, grant) => tokenGrantRepository(tx).revoke(grant.id, new Date()),
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
      verifyRealmAUnaffected: async (tx, grant) => {
        const found = await tokenGrantRepository(tx).byId(grant.id);
        expect(found?.revokedAt).toBeNull();
      },
    });
  });
});
