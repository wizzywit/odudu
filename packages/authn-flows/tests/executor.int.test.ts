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
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { establishSession, loadPendingRequest, startAuthentication } from '#/service/executor';
import { sessions } from '#/schema/sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';

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

const request: PendingRequest = {
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
};

async function seedRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
}

describe('realm isolation', () => {
  it.each(['authentication_sessions', 'sessions'])('isolates %s by realm', async (table) => {
    await expectRealmIsolation(app.db, {
      table,
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        if (table === 'authentication_sessions') {
          await startAuthentication(tx, realmId, request);
        } else {
          const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
          await establishSession(tx, realmId, subject.id);
        }
      },
    });
  });
});

describe('cross-realm resume is blocked', () => {
  it('cannot load a pending request parked under a different realm context', async () => {
    const realmA = newId();
    const realmB = newId();

    const authSessionId = await withRealm(app.db, realmA, async (tx) => {
      await seedRealm(tx, realmA);
      return (await startAuthentication(tx, realmA, request)).authSessionId;
    });

    await withRealm(app.db, realmB, async (tx) => seedRealm(tx, realmB));

    const loadedFromB = await withRealm(app.db, realmB, async (tx) =>
      loadPendingRequest(tx, authSessionId),
    );
    expect(loadedFromB).toBeNull();

    const loadedFromA = await withRealm(app.db, realmA, async (tx) =>
      loadPendingRequest(tx, authSessionId),
    );
    expect(loadedFromA).toEqual(request);
  });

  it('cannot resume a session established under a different realm context', async () => {
    const realmA = newId();
    const realmB = newId();

    const sessionId = await withRealm(app.db, realmA, async (tx) => {
      await seedRealm(tx, realmA);
      const subject = await subjectRepository(tx).create({ realmId: realmA, type: 'user' });
      return (await establishSession(tx, realmA, subject.id)).sessionId;
    });

    await withRealm(app.db, realmB, async (tx) => seedRealm(tx, realmB));

    const rowsFromB = await withRealm(app.db, realmB, async (tx) =>
      tx.select().from(sessions).where(eq(sessions.id, sessionId)),
    );
    expect(rowsFromB).toEqual([]);

    const rowsFromA = await withRealm(app.db, realmA, async (tx) =>
      tx.select().from(sessions).where(eq(sessions.id, sessionId)),
    );
    expect(rowsFromA).toHaveLength(1);
  });
});
