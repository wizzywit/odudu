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
import { newId, OduduError } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialRepository } from '#/repository/credentials';
import { loginFailureRepository } from '#/repository/login-failures';
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

  it('finds a user by email', async () => {
    const realmId = newId();
    const email = `ada-${newId()}@example.test`;

    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      await insertUserRow(tx, subject.id, realmId, { email });
      return subject.id;
    });

    const found = await withRealm(app.db, realmId, async (tx) => userRepository(tx).byEmail(email));
    expect(found?.subjectId).toBe(subjectId);
  });

  it('returns null when no user has that email', async () => {
    const realmId = newId();

    const found = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      return userRepository(tx).byEmail('nobody@example.test');
    });
    expect(found).toBeNull();
  });

  it('cannot find a user by email under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
        const email = `ada-${newId()}@example.test`;
        await insertUserRow(tx, subject.id, realmId, { email });
        return email;
      },
      verifySeeded: async (tx, email) => {
        const found = await userRepository(tx).byEmail(email);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, email) => userRepository(tx).byEmail(email),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
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
        secretData: { hash: '$argon2id$fake-hash' },
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
          secretData: { hash: '$argon2id$fake-hash' },
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

  it('replaces the stored password', async () => {
    const realmId = newId();

    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      await credentialRepository(tx).insert({
        realmId,
        subjectId: subject.id,
        type: 'password',
        secret: { kind: 'password', hash: '$argon2id$old-hash' },
      });
      return subject.id;
    });

    await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).setPassword(subjectId, '$argon2id$new-hash'),
    );

    const password = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).passwordFor(subjectId),
    );
    expect(password).toBe('$argon2id$new-hash');
  });

  it('refuses to set a password with no existing credential row', async () => {
    const realmId = newId();

    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      return subject.id;
    });

    const failure = withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).setPassword(subjectId, '$argon2id$new-hash'),
    );
    await expect(failure).rejects.toThrow(OduduError);
    await expect(failure).rejects.toMatchObject({ code: 'credential_not_found' });
  });

  it('cannot replace a password credential under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
        await tx.insert(userCredentials).values({
          id: newId(),
          realmId,
          subjectId: subject.id,
          type: 'password',
          secretData: { hash: '$argon2id$fake-hash' },
        });
        return subject.id;
      },
      verifySeeded: async (tx, subjectId) => {
        const found = await credentialRepository(tx).passwordFor(subjectId);
        expect(found).toBe('$argon2id$fake-hash');
      },
      attempt: async (tx, subjectId) => {
        try {
          await credentialRepository(tx).setPassword(subjectId, '$argon2id$attacker-hash');
          return 'succeeded';
        } catch {
          return 'blocked';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('blocked');
      },
      verifyRealmAUnaffected: async (tx, subjectId) => {
        const password = await credentialRepository(tx).passwordFor(subjectId);
        expect(password).toBe('$argon2id$fake-hash');
      },
    });
  });

  it('retires the displaced hash and keeps only the depth asked for', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      await credentialRepository(tx).insert({
        realmId,
        subjectId: subject.id,
        type: 'password',
        secret: { kind: 'password', hash: '$argon2id$one' },
      });
      return subject.id;
    });

    for (const [from, to] of [
      ['$argon2id$one', '$argon2id$two'],
      ['$argon2id$two', '$argon2id$three'],
      ['$argon2id$three', '$argon2id$four'],
    ] as const) {
      const rotated = await withRealm(app.db, realmId, (tx) =>
        credentialRepository(tx).rotatePassword(subjectId, { from, to }, 2),
      );
      expect(rotated).toBe(true);
    }

    const state = await withRealm(app.db, realmId, async (tx) => ({
      current: await credentialRepository(tx).passwordFor(subjectId),
      history: await credentialRepository(tx).passwordHistory(subjectId),
    }));
    expect(state.current).toBe('$argon2id$four');
    expect(state.history).toEqual(['$argon2id$three', '$argon2id$two']);
  });

  // The write is the decision, not a record of one: a rotation against a
  // hash that is no longer in force archives nothing and reports it.
  it('refuses a rotation whose outgoing hash has already been replaced', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      await credentialRepository(tx).insert({
        realmId,
        subjectId: subject.id,
        type: 'password',
        secret: { kind: 'password', hash: '$argon2id$one' },
      });
      return subject.id;
    });

    const stale = await withRealm(app.db, realmId, (tx) =>
      credentialRepository(tx).rotatePassword(
        subjectId,
        { from: '$argon2id$never-was', to: '$argon2id$two' },
        4,
      ),
    );

    expect(stale).toBe(false);
    const after = await withRealm(app.db, realmId, async (tx) => ({
      current: await credentialRepository(tx).passwordFor(subjectId),
      history: await credentialRepository(tx).passwordHistory(subjectId),
    }));
    expect(after).toEqual({ current: '$argon2id$one', history: [] });
  });

  it('reads no password history under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
        await tx.insert(userCredentials).values({
          id: newId(),
          realmId,
          subjectId: subject.id,
          type: 'password-history',
          secretData: { hash: '$argon2id$retired' },
        });
        return subject.id;
      },
      verifySeeded: async (tx, subjectId) => {
        expect(await credentialRepository(tx).passwordHistory(subjectId)).toEqual([
          '$argon2id$retired',
        ]);
      },
      attempt: async (tx, subjectId) => credentialRepository(tx).passwordHistory(subjectId),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });

  it('cannot rotate a password under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
        await tx.insert(userCredentials).values({
          id: newId(),
          realmId,
          subjectId: subject.id,
          type: 'password',
          secretData: { hash: '$argon2id$fake-hash' },
        });
        return subject.id;
      },
      verifySeeded: async (tx, subjectId) => {
        expect(await credentialRepository(tx).passwordFor(subjectId)).toBe('$argon2id$fake-hash');
      },
      attempt: async (tx, subjectId) =>
        credentialRepository(tx).rotatePassword(
          subjectId,
          { from: '$argon2id$fake-hash', to: '$argon2id$attacker-hash' },
          4,
        ),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyRealmAUnaffected: async (tx, subjectId) => {
        expect(await credentialRepository(tx).passwordFor(subjectId)).toBe('$argon2id$fake-hash');
        expect(await credentialRepository(tx).passwordHistory(subjectId)).toEqual([]);
      },
    });
  });
});

describe('loginFailureRepository', () => {
  const POLICY = {
    maxFailures: 3,
    lockoutSeconds: 60,
    maxLockoutSeconds: 240,
    failureResetSeconds: 3600,
  };
  const AT = new Date('2026-09-15T12:00:00Z');

  // Seeded through the repository's own write rather than an insert, so the
  // probe fails if `recordFailure` ever stops being able to create the row.
  async function seedFailures(tx: RealmScopedDatabase, realmId: string): Promise<string> {
    await seedRealm(tx, realmId);
    const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
    await loginFailureRepository(tx).recordFailure(subject.id, POLICY, AT);
    await loginFailureRepository(tx).recordFailure(subject.id, POLICY, AT);
    return subject.id;
  }

  // The retry behind the compare-and-swap, from the inside: every one of six
  // concurrent writers has to end `recorded`, not merely leave the count at
  // six. A writer that gave up would be an attempt nobody counted, and the
  // count alone cannot tell that apart from a writer that won.
  it('records every concurrent failure rather than giving one of them up', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, async (tx) => {
      await seedRealm(tx, realmId);
      const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
      return subject.id;
    });

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        withRealm(app.db, realmId, (tx) =>
          loginFailureRepository(tx).recordFailure(subjectId, { ...POLICY, maxFailures: 20 }, AT),
        ),
      ),
    );

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(Array(6).fill('recorded'));
    expect(
      await withRealm(app.db, realmId, (tx) => loginFailureRepository(tx).forSubject(subjectId)),
    ).toMatchObject({ failureCount: 6 });
  });

  it('reads no failure count under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: seedFailures,
      // The blocked read answers the same zeros a subject who has never
      // failed does, so the seeded read has to prove a non-zero count —
      // otherwise the probe holds whether the policy filters or not.
      verifySeeded: async (tx, subjectId) => {
        expect(await loginFailureRepository(tx).forSubject(subjectId)).toMatchObject({
          failureCount: 2,
        });
      },
      attempt: async (tx, subjectId) => loginFailureRepository(tx).forSubject(subjectId),
      expectBlocked: (result) => {
        expect(result).toMatchObject({ failureCount: 0, lockedUntil: null });
      },
    });
  });

  it('cannot record a failure against another realm’s subject', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: seedFailures,
      verifySeeded: async (tx, subjectId) => {
        expect(await loginFailureRepository(tx).recordFailure(subjectId, POLICY, AT)).toMatchObject(
          {
            kind: 'recorded',
            state: { failureCount: 3 },
          },
        );
      },
      attempt: async (tx, subjectId) =>
        loginFailureRepository(tx).recordFailure(subjectId, POLICY, AT),
      // Not `contended`: the write found no subject to write against, which
      // is a policy that filtered the row rather than a lost race.
      expectBlocked: (result) => {
        expect(result).toEqual({ kind: 'no_subject' });
      },
      // A cross-realm write that locked somebody out would be a denial of
      // service on an account in a realm the caller cannot even read.
      verifyRealmAUnaffected: async (tx, subjectId) => {
        expect(await loginFailureRepository(tx).forSubject(subjectId)).toMatchObject({
          failureCount: 3,
        });
      },
    });
  });

  it('cannot clear another realm’s failure count', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: seedFailures,
      verifySeeded: async (tx, subjectId) => {
        expect(await loginFailureRepository(tx).forSubject(subjectId)).toMatchObject({
          failureCount: 2,
        });
      },
      attempt: async (tx, subjectId) => loginFailureRepository(tx).clear(subjectId),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      // The one that matters most: clearing across realms would let anybody
      // with a realm of their own unlock an account in somebody else's.
      verifyRealmAUnaffected: async (tx, subjectId) => {
        expect(await loginFailureRepository(tx).forSubject(subjectId)).toMatchObject({
          failureCount: 2,
        });
      },
    });
  });
});

describe('realm isolation', () => {
  it.each(['subjects', 'users', 'user_credentials', 'login_failures'])(
    'isolates %s by realm',
    async (table) => {
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
              secretData: { hash: '$argon2id$fake-hash' },
            });
          } else if (table === 'login_failures') {
            await loginFailureRepository(tx).recordFailure(
              subjectId,
              {
                maxFailures: 3,
                lockoutSeconds: 60,
                maxLockoutSeconds: 240,
                failureResetSeconds: 3600,
              },
              new Date('2026-09-15T12:00:00Z'),
            );
          }
        },
      });
    },
  );
});
