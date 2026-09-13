import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectCrossRealmMethodProbe, expectRealmIsolation } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialRepository } from '#/repository/credentials';
import { subjectRepository } from '#/repository/subjects';
import { userRepository } from '#/repository/users';
import { isEmailAddress } from '#/service/email';
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

  it('cannot find a subject by id under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        return subjectRepository(tx).create({ realmId, type: 'user' });
      },
      verifySeeded: async (tx, subject) => {
        const found = await subjectRepository(tx).byId(subject.id);
        expect(found?.id).toBe(subject.id);
      },
      attempt: async (tx, subject) => subjectRepository(tx).byId(subject.id),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
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

  // OIDC Core §5.1: the `email` claim is emitted verbatim from this column.
  // users_email_addr_spec is what makes that true; this method refuses the
  // same values earlier, so an operator gets a message naming the option
  // rather than a constraint-violation stack.
  it('refuses to store an address the email claim could not carry', async () => {
    const realmId = newId();

    await expect(
      withRealm(app.db, realmId, async (tx) => {
        await seedRealm(tx, realmId);
        const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
        return userRepository(tx).create({
          subjectId: subject.id,
          realmId,
          username: `mallory-${newId()}`,
          email: 'not an address',
        });
      }),
    ).rejects.toMatchObject({ code: 'invalid_email' });
  });

  // apps/server/src/logger.ts allowlists what may be logged so end-user data
  // does not reach a log line; an error message carrying the address would
  // walk straight past that the moment anything logs `{ err }`.
  it('keeps the rejected address out of the error it throws', async () => {
    const realmId = newId();

    const rejected = 'mallory the unrouteable';
    const error = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      return userRepository(tx)
        .create({
          subjectId: subject.id,
          realmId,
          username: `mallory-${newId()}`,
          email: rejected,
        })
        .then(
          () => null,
          (caught: unknown) => caught,
        );
    });

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(rejected);
  });

  it('stores a conforming address, and stores no address at all without complaint', async () => {
    const realmId = newId();

    const [withEmail, withoutEmail] = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const one = await subjectRepository(tx).create({ realmId, type: 'user' });
      const two = await subjectRepository(tx).create({ realmId, type: 'user' });
      return [
        await userRepository(tx).create({
          subjectId: one.id,
          realmId,
          username: `carol-${newId()}`,
          email: 'carol.o-brien+tag@mail.example.com',
        }),
        await userRepository(tx).create({
          subjectId: two.id,
          realmId,
          username: `dave-${newId()}`,
        }),
      ];
    });

    expect(withEmail.email).toBe('carol.o-brien+tag@mail.example.com');
    expect(withoutEmail.email).toBeNull();
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

  it('finds a user by subject id', async () => {
    const realmId = newId();
    const username = `bob-${newId()}`;

    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      await insertUserRow(tx, subject.id, realmId, { username, email: 'bob@example.com' });
      return subject.id;
    });

    const found = await withRealm(app.db, realmId, async (tx) =>
      userRepository(tx).bySubjectId(subjectId),
    );

    expect(found?.username).toBe(username);
    expect(found?.email).toBe('bob@example.com');
  });

  it('returns null from bySubjectId for a subject with no user row', async () => {
    const realmId = newId();

    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'service' });
      return subject.id;
    });

    const found = await withRealm(app.db, realmId, async (tx) =>
      userRepository(tx).bySubjectId(subjectId),
    );

    expect(found).toBeNull();
  });

  it('cannot find a user by username under a different realm context', async () => {
    const realmA = newId();
    const realmB = newId();
    const username = `carol-${newId()}`;

    await withRealm(app.db, realmA, async (tx) => {
      await seedRealm(tx, realmA);
      const subject = await subjectRepository(tx).create({ realmId: realmA, type: 'user' });
      await insertUserRow(tx, subject.id, realmA, { username });
    });

    await withRealm(app.db, realmB, async (tx) => seedRealm(tx, realmB));

    const foundFromB = await withRealm(app.db, realmB, async (tx) =>
      userRepository(tx).byUsername(username),
    );
    expect(foundFromB).toBeNull();

    const foundFromA = await withRealm(app.db, realmA, async (tx) =>
      userRepository(tx).byUsername(username),
    );
    expect(foundFromA?.user.username).toBe(username);
  });

  it('cannot find a user by subject id under a different realm context', async () => {
    const realmA = newId();
    const realmB = newId();

    const subjectId = await withRealm(app.db, realmA, async (tx) => {
      await seedRealm(tx, realmA);
      const subject = await subjectRepository(tx).create({ realmId: realmA, type: 'user' });
      await insertUserRow(tx, subject.id, realmA, { email: 'carol@example.com' });
      return subject.id;
    });

    await withRealm(app.db, realmB, async (tx) => seedRealm(tx, realmB));

    const foundFromB = await withRealm(app.db, realmB, async (tx) =>
      userRepository(tx).bySubjectId(subjectId),
    );
    expect(foundFromB).toBeNull();

    const foundFromA = await withRealm(app.db, realmA, async (tx) =>
      userRepository(tx).bySubjectId(subjectId),
    );
    expect(foundFromA?.email).toBe('carol@example.com');
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

// The repository guard constrains one writer. The column constrains every
// writer there will ever be, which is what the OIDC Core §5.1 row claims.
describe('users_email_addr_spec, the column constraint behind the email claim', () => {
  it('refuses a non-conforming address inserted straight into the table', async () => {
    const realmId = newId();

    await expect(
      withRealm(app.db, realmId, async (tx) => {
        await seedRealm(tx, realmId);
        const subjectId = await insertSubject(tx, realmId);
        await insertUserRow(tx, subjectId, realmId, { email: 'not an address' });
      }),
      // Drizzle wraps the driver error; the SQLSTATE and the constraint name
      // are on .cause.
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'users_email_addr_spec' },
    });
  });

  // Two spellings of one rule — this predicate and `isEmailAddress` — drift
  // unless something compares them. The repository's error message would
  // start describing a form the column no longer accepts, or, worse, the
  // column would accept what the repository promised to refuse.
  it('accepts exactly what isEmailAddress accepts', async () => {
    const cases = [
      'alice@example.com',
      'carol.o-brien+tag@mail.example.com',
      "!#$%&'*+/=?^_`{|}~-@example.com",
      'a@b.co',
      'ALICE@EXAMPLE.COM',
      'alice@sub.domain.example.co.uk',
      `${'a'.repeat(64)}@example.com`,
      `${'a'.repeat(65)}@example.com`,
      'not an address',
      '',
      '@example.com',
      'alice@',
      'alice@example',
      '.alice@example.com',
      'alice.@example.com',
      'ali..ce@example.com',
      'alice@.example.com',
      'alice@example..com',
      'alice@-example.com',
      'alice@example-.com',
      'alice@[192.0.2.1]',
      '"quoted local"@example.com',
      'alice(comment)@example.com',
      ' alice@example.com',
      'alice@example.com ',
      'alice@exa mple.com',
      'alice@@example.com',
      'alice@example.com\nbob@example.com',
      `${'a'.repeat(250)}@example.com`,
    ];

    const realmId = newId();
    await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
    });

    // One transaction per case: a constraint violation aborts the
    // transaction it happens in, and every statement after it in that
    // transaction fails for a reason that has nothing to do with the address.
    const accepted: boolean[] = [];
    for (const candidate of cases) {
      accepted.push(
        await withRealm(app.db, realmId, async (tx) => {
          const subjectId = await insertSubject(tx, realmId);
          await insertUserRow(tx, subjectId, realmId, { email: candidate });
        }).then(
          () => true,
          () => false,
        ),
      );
    }

    expect(Object.fromEntries(cases.map((c, i) => [c, accepted[i]]))).toEqual(
      Object.fromEntries(cases.map((c) => [c, isEmailAddress(c)])),
    );
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

  it('finds no password credential under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
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
      },
      verifySeeded: async (tx, subjectId) => {
        const found = await credentialRepository(tx).passwordFor(subjectId);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, subjectId) => credentialRepository(tx).passwordFor(subjectId),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
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
