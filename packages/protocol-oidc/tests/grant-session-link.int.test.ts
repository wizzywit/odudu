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
import { sessionRepository, provisionRealm } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenGrantRepository } from '#/repository/grants';

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

async function seedRealmClientSubject(
  tx: RealmScopedDatabase,
  realmId: string,
): Promise<{ clientDbId: string; subjectId: string }> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
  await provisionRealm(tx, realmId);
  const clientDbId = newId();
  await tx.insert(clients).values({
    id: clientDbId,
    realmId,
    clientId: `client-${realmId}`,
    name: 'A client',
    type: 'confidential',
    secretHash: 'hashed:secret',
  });
  await provisionClientDefaults(tx, clientDbId);
  const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
  return { clientDbId, subjectId: subject.id };
}

describe('a grant and the session it belongs to', () => {
  it('revokes every grant of one session and leaves an offline grant alone', async () => {
    const realmId = newId();
    const sessionId = newId();

    const { clientDbId, subjectId } = await withRealm(app.db, realmId, (tx) =>
      seedRealmClientSubject(tx, realmId),
    );
    await withRealm(app.db, realmId, (tx) =>
      sessionRepository(tx).create({
        id: sessionId,
        realmId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
      }),
    );

    const [bound, offline] = await withRealm(app.db, realmId, async (tx) => {
      const repository = tokenGrantRepository(tx);
      return [
        await repository.create({
          realmId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid',
          audience: [],
          sessionId,
        }),
        await repository.create({
          realmId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid offline_access',
          audience: [],
          sessionId: null,
        }),
      ];
    });

    const revoked = await withRealm(app.db, realmId, (tx) =>
      tokenGrantRepository(tx).revokeForSession(sessionId, new Date()),
    );
    expect(revoked).toBe(1);

    await withRealm(app.db, realmId, async (tx) => {
      const repository = tokenGrantRepository(tx);
      expect((await repository.byId(bound.id))?.revokedAt).not.toBeNull();
      expect((await repository.byId(offline.id))?.revokedAt).toBeNull();
      expect((await repository.byId(offline.id))?.sessionId).toBeNull();
    });
  });

  it('cannot revoke a foreign realm’s session grants', async () => {
    const mineRealmId = newId();
    const theirsRealmId = newId();
    const sessionId = newId();

    await withRealm(app.db, mineRealmId, (tx) => seedRealmClientSubject(tx, mineRealmId));
    const { clientDbId, subjectId } = await withRealm(app.db, theirsRealmId, (tx) =>
      seedRealmClientSubject(tx, theirsRealmId),
    );
    await withRealm(app.db, theirsRealmId, async (tx) => {
      await sessionRepository(tx).create({
        id: sessionId,
        realmId: theirsRealmId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
      });
      await tokenGrantRepository(tx).create({
        realmId: theirsRealmId,
        clientId: clientDbId,
        subjectId,
        scope: 'openid',
        audience: [],
        sessionId,
      });
    });

    const revoked = await withRealm(app.db, mineRealmId, (tx) =>
      tokenGrantRepository(tx).revokeForSession(sessionId, new Date()),
    );
    expect(revoked).toBe(0);
  });

  it('finds every grant of one session and not an offline grant for the same subject', async () => {
    const realmId = newId();
    const sessionId = newId();

    const { clientDbId, subjectId } = await withRealm(app.db, realmId, (tx) =>
      seedRealmClientSubject(tx, realmId),
    );
    await withRealm(app.db, realmId, (tx) =>
      sessionRepository(tx).create({
        id: sessionId,
        realmId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
      }),
    );

    const [first, second] = await withRealm(app.db, realmId, async (tx) => {
      const repository = tokenGrantRepository(tx);
      return [
        await repository.create({
          realmId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid',
          audience: [],
          sessionId,
        }),
        await repository.create({
          realmId,
          clientId: clientDbId,
          subjectId,
          scope: 'profile',
          audience: [],
          sessionId,
        }),
      ];
    });
    await withRealm(app.db, realmId, (tx) =>
      tokenGrantRepository(tx).create({
        realmId,
        clientId: clientDbId,
        subjectId,
        scope: 'openid offline_access',
        audience: [],
        sessionId: null,
      }),
    );

    const found = await withRealm(app.db, realmId, (tx) =>
      tokenGrantRepository(tx).bySession(sessionId),
    );
    expect(found.map((grant) => grant.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('cannot find a foreign realm’s session grants', async () => {
    const theirsRealmId = newId();
    const mineRealmId = newId();
    const sessionId = newId();

    await withRealm(app.db, mineRealmId, (tx) => seedRealmClientSubject(tx, mineRealmId));
    const { clientDbId, subjectId } = await withRealm(app.db, theirsRealmId, (tx) =>
      seedRealmClientSubject(tx, theirsRealmId),
    );
    await withRealm(app.db, theirsRealmId, async (tx) => {
      await sessionRepository(tx).create({
        id: sessionId,
        realmId: theirsRealmId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
      });
      await tokenGrantRepository(tx).create({
        realmId: theirsRealmId,
        clientId: clientDbId,
        subjectId,
        scope: 'openid',
        audience: [],
        sessionId,
      });
    });

    const found = await withRealm(app.db, mineRealmId, (tx) =>
      tokenGrantRepository(tx).bySession(sessionId),
    );
    expect(found).toEqual([]);
  });
});
