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
import { credentialRepository } from '#/repository/credentials';
import { subjectRepository } from '#/repository/subjects';
import { userRepository } from '#/repository/users';
import { subjects } from '#/schema/subjects';
import { userCredentials } from '#/schema/user-credentials';
import { users } from '#/schema/users';

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

async function insertSubject(
  tx: RealmScopedDatabase,
  realmId: string,
  overrides: Partial<typeof subjects.$inferInsert> = {},
): Promise<string> {
  const id = overrides.id ?? newId();
  await tx.insert(subjects).values({ id, realmId, type: 'user', ...overrides });
  return id;
}

async function insertUserRow(
  tx: RealmScopedDatabase,
  subjectId: string,
  realmId: string,
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<void> {
  await tx.insert(users).values({
    subjectId,
    realmId,
    username: `user-${newId()}`,
    ...overrides,
  });
}

describe('subjectRepository', () => {
  it('creates a subject through the repository', async () => {
    const realmId = newId();

    const created = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      return subjectRepository(tx).create({ realmId, type: 'service' });
    });

    expect(created.realmId).toBe(realmId);
    expect(created.type).toBe('service');
    expect(created.disabledAt).toBeNull();

    const found = await withRealm(app.db, realmId, async (tx) =>
      subjectRepository(tx).byId(created.id),
    );
    expect(found?.id).toBe(created.id);
  });
});

describe('userRepository', () => {
  it('finds a user with its subject by username', async () => {
    const realmId = newId();
    const username = `alice-${newId()}`;

    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      await insertUserRow(tx, subject.id, realmId, { username });
    });

    const found = await withRealm(app.db, realmId, async (tx) =>
      userRepository(tx).byUsername(username),
    );

    expect(found).not.toBeNull();
    expect(found?.user.username).toBe(username);
    expect(found?.subject.type).toBe('user');
    expect(found?.subject.realmId).toBe(realmId);
  });

  it('returns null when no user matches', async () => {
    const realmId = newId();

    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
    });

    const found = await withRealm(app.db, realmId, async (tx) =>
      userRepository(tx).byUsername('does-not-exist'),
    );

    expect(found).toBeNull();
  });

  it('refuses a user whose realm differs from its subject', async () => {
    const realmA = newId();
    const realmB = newId();

    let error: unknown;
    try {
      await withRealm(app.db, realmA, async (tx) => {
        await seedRealm(tx, realmA);
      });
      await withRealm(app.db, realmB, async (tx) => {
        await seedRealm(tx, realmB);
      });

      const subjectId = await withRealm(app.db, realmA, async (tx) => {
        const subject = await subjectRepository(tx).create({ realmId: realmA, type: 'user' });
        return subject.id;
      });

      // The subject belongs to realmA; inserting the user row under realmB
      // must be rejected by the composite foreign key, not silently allowed.
      await withRealm(app.db, realmB, async (tx) => {
        await insertUserRow(tx, subjectId, realmB);
      });
      expect.unreachable('expected the realm-mismatched user insert to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('users_subject_realm_fk');
  });
});

describe('credentialRepository', () => {
  it('finds a password credential by subject id', async () => {
    const realmId = newId();

    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      await tx.insert(userCredentials).values({
        id: newId(),
        realmId,
        subjectId: subject.id,
        type: 'password',
        secretData: '$argon2id$fake-hash',
      });
      return subject.id;
    });

    const password = await withRealm(app.db, realmId, async (tx) =>
      credentialRepository(tx).passwordFor(subjectId),
    );

    expect(password).toBe('$argon2id$fake-hash');
  });

  it('returns null when no credential matches', async () => {
    const realmId = newId();

    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      return subject.id;
    });

    const password = await withRealm(app.db, realmId, async (tx) =>
      credentialRepository(tx).passwordFor(subjectId),
    );

    expect(password).toBeNull();
  });
});

describe('realm isolation', () => {
  it.each(['subjects', 'users', 'user_credentials'])('isolates %s by realm', async (table) => {
    await expectRealmIsolation(app.db, {
      table,
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subjectId = await insertSubject(tx, realmId);
        if (table === 'users') {
          await insertUserRow(tx, subjectId, realmId);
        } else if (table === 'user_credentials') {
          await tx.insert(userCredentials).values({
            id: newId(),
            realmId,
            subjectId,
            type: 'password',
            secretData: '$argon2id$fake-hash',
          });
        }
      },
    });
  });
});
