import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe, expectTenantIsolation } from '@odudu/db/testing';
import { newId, OduduError } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
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

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

async function insertSubject(
  tx: TenantScopedDatabase,
  tenantId: string,
  overrides: Partial<typeof subjects.$inferInsert> = {},
): Promise<string> {
  const id = overrides.id ?? newId();
  await tx.insert(subjects).values({ id, tenantId, type: 'user', ...overrides });
  return id;
}

async function insertUserRow(
  tx: TenantScopedDatabase,
  subjectId: string,
  tenantId: string,
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<void> {
  await tx.insert(users).values({
    subjectId,
    tenantId,
    username: `user-${newId()}`,
    ...overrides,
  });
}

describe('subjectRepository', () => {
  it('creates a subject through the repository', async () => {
    const tenantId = newId();

    const created = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      return subjectRepository(tx).create({ tenantId, type: 'service' });
    });

    expect(created.tenantId).toBe(tenantId);
    expect(created.type).toBe('service');
    expect(created.disabledAt).toBeNull();

    const found = await withTenant(app.db, tenantId, async (tx) =>
      subjectRepository(tx).byId(created.id),
    );
    expect(found?.id).toBe(created.id);
  });

  it('cannot find a subject by id under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return subjectRepository(tx).create({ tenantId, type: 'user' });
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

  it('locks a subject that exists, and finds none to lock for an unknown id', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      expect(await subjectRepository(tx).lock(subject.id)).toBe(true);
      expect(await subjectRepository(tx).lock(newId())).toBe(false);
    });
  });

  it('cannot lock a subject under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return subjectRepository(tx).create({ tenantId, type: 'user' });
      },
      verifySeeded: async (tx, subject) => {
        expect(await subjectRepository(tx).lock(subject.id)).toBe(true);
      },
      attempt: async (tx, subject) => subjectRepository(tx).lock(subject.id),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
    });
  });

  it('makes a second lock on the same subject wait for the first transaction to end', async () => {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      return (await subjectRepository(tx).create({ tenantId, type: 'user' })).id;
    });
    const order: string[] = [];
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockedFirst = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const first = withTenant(app.db, tenantId, async (tx) => {
      await subjectRepository(tx).lock(subjectId);
      locked();
      await hold;
      order.push('first ends');
    });
    await lockedFirst;
    const second = withTenant(app.db, tenantId, async (tx) => {
      await subjectRepository(tx).lock(subjectId);
      order.push('second locks');
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first ends', 'second locks']);
  });

  it('leaves disabled_at unchanged on a repeated disable', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });

      const first = await subjectRepository(tx).setEnabled(subject.id, false);
      expect(first.disabledAt).not.toBeNull();

      const second = await subjectRepository(tx).setEnabled(subject.id, false);
      expect(second.disabledAt?.getTime()).toBe(first.disabledAt?.getTime());
    });
  });

  it('cannot disable a subject under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return subjectRepository(tx).create({ tenantId, type: 'user' });
      },
      verifySeeded: async (tx, subject) => {
        const found = await subjectRepository(tx).byId(subject.id);
        expect(found?.disabledAt).toBeNull();
      },
      attempt: async (tx, subject) => {
        try {
          await subjectRepository(tx).setEnabled(subject.id, false);
          return 'succeeded';
        } catch {
          return 'blocked';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('blocked');
      },
      verifyTenantAUnaffected: async (tx, subject) => {
        const found = await subjectRepository(tx).byId(subject.id);
        expect(found?.disabledAt).toBeNull();
      },
    });
  });

  it('deletes a subject and says whether there was one', async () => {
    const tenantId = newId();
    const subject = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      return subjectRepository(tx).create({ tenantId, type: 'service' });
    });
    await withTenant(app.db, tenantId, async (tx) => {
      expect(await subjectRepository(tx).delete(subject.id)).toBe(true);
      expect(await subjectRepository(tx).delete(subject.id)).toBe(false);
      expect(await subjectRepository(tx).byId(subject.id)).toBeNull();
    });
  });

  it('cannot delete a subject under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        return subjectRepository(tx).create({ tenantId, type: 'service' });
      },
      verifySeeded: async (tx, subject) => {
        expect(await subjectRepository(tx).byId(subject.id)).not.toBeNull();
      },
      attempt: (tx, subject) => subjectRepository(tx).delete(subject.id),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, subject) => {
        expect(await subjectRepository(tx).byId(subject.id)).not.toBeNull();
      },
    });
  });
});

describe('userRepository', () => {
  it('finds a user by a verified address in any case, and only by a verified one', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const verified = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await insertUserRow(tx, verified.id, tenantId, {
        email: 'Ada@Example.test',
        emailVerified: true,
      });
      const unverified = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await insertUserRow(tx, unverified.id, tenantId, { email: 'bob@example.test' });

      const found = await userRepository(tx).byVerifiedEmail('ADA@example.TEST');
      expect(found?.subject.id).toBe(verified.id);
      expect(await userRepository(tx).byVerifiedEmail('bob@example.test')).toBeNull();
    });
  });

  it('answers no user for an address two users hold in different cases', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      for (const email of ['ada@example.test', 'ADA@example.test']) {
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await insertUserRow(tx, subject.id, tenantId, { email, emailVerified: true });
      }
      expect(await userRepository(tx).byVerifiedEmail('ada@example.test')).toBeNull();
    });
  });

  it('cannot find a user by a verified address under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const email = `ada-${newId()}@example.test`;
        await insertUserRow(tx, subject.id, tenantId, { email, emailVerified: true });
        return email;
      },
      verifySeeded: async (tx, email) => {
        expect(await userRepository(tx).byVerifiedEmail(email)).not.toBeNull();
      },
      attempt: async (tx, email) => userRepository(tx).byVerifiedEmail(email),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('finds the holder of an address in any case, verified or not, the same one every time', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const first = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await insertUserRow(tx, first.id, tenantId, { email: 'Ada@Example.test' });
      const second = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await insertUserRow(tx, second.id, tenantId, { email: 'ada@example.test' });

      const holder = await userRepository(tx).holderOfEmail('ADA@example.TEST');
      expect([first.id, second.id]).toContain(holder);
      expect(await userRepository(tx).holderOfEmail('ADA@example.TEST')).toBe(holder);
      expect(await userRepository(tx).holderOfEmail('bea@example.test')).toBeNull();
    });
  });

  it('cannot find the holder of an address under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const email = `ada-${newId()}@example.test`;
        await insertUserRow(tx, subject.id, tenantId, { email });
        return email;
      },
      verifySeeded: async (tx, email) => {
        expect(await userRepository(tx).holderOfEmail(email.toUpperCase())).not.toBeNull();
      },
      attempt: async (tx, email) => userRepository(tx).holderOfEmail(email),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('finds a user with its subject by username', async () => {
    const tenantId = newId();
    const username = `alice-${newId()}`;

    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await insertUserRow(tx, subject.id, tenantId, { username });
    });

    const found = await withTenant(app.db, tenantId, async (tx) =>
      userRepository(tx).byUsername(username),
    );

    expect(found).not.toBeNull();
    expect(found?.user.username).toBe(username);
    expect(found?.subject.type).toBe('user');
    expect(found?.subject.tenantId).toBe(tenantId);
  });

  it('finds a user by email', async () => {
    const tenantId = newId();
    const email = `ada-${newId()}@example.test`;

    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await insertUserRow(tx, subject.id, tenantId, { email });
      return subject.id;
    });

    const found = await withTenant(app.db, tenantId, async (tx) =>
      userRepository(tx).byEmail(email),
    );
    expect(found?.subjectId).toBe(subjectId);
  });

  it('returns null when no user has that email', async () => {
    const tenantId = newId();

    const found = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      return userRepository(tx).byEmail('nobody@example.test');
    });
    expect(found).toBeNull();
  });

  it('cannot find a user by email under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        const email = `ada-${newId()}@example.test`;
        await insertUserRow(tx, subject.id, tenantId, { email });
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
    const tenantId = newId();

    await expect(
      withTenant(app.db, tenantId, async (tx) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        return userRepository(tx).create({
          subjectId: subject.id,
          tenantId,
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
    const tenantId = newId();

    const rejected = 'mallory the unrouteable';
    const error = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return userRepository(tx)
        .create({
          subjectId: subject.id,
          tenantId,
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
    const tenantId = newId();

    const [withEmail, withoutEmail] = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const one = await subjectRepository(tx).create({ tenantId, type: 'user' });
      const two = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return [
        await userRepository(tx).create({
          subjectId: one.id,
          tenantId,
          username: `carol-${newId()}`,
          email: 'carol.o-brien+tag@mail.example.com',
        }),
        await userRepository(tx).create({
          subjectId: two.id,
          tenantId,
          username: `dave-${newId()}`,
        }),
      ];
    });

    expect(withEmail.email).toBe('carol.o-brien+tag@mail.example.com');
    expect(withoutEmail.email).toBeNull();
  });

  it('returns null when no user matches', async () => {
    const tenantId = newId();

    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
    });

    const found = await withTenant(app.db, tenantId, async (tx) =>
      userRepository(tx).byUsername('does-not-exist'),
    );

    expect(found).toBeNull();
  });

  it('finds a user by subject id', async () => {
    const tenantId = newId();
    const username = `bob-${newId()}`;

    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await insertUserRow(tx, subject.id, tenantId, { username, email: 'bob@example.com' });
      return subject.id;
    });

    const found = await withTenant(app.db, tenantId, async (tx) =>
      userRepository(tx).bySubjectId(subjectId),
    );

    expect(found?.username).toBe(username);
    expect(found?.email).toBe('bob@example.com');
  });

  it('returns null from bySubjectId for a subject with no user row', async () => {
    const tenantId = newId();

    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'service' });
      return subject.id;
    });

    const found = await withTenant(app.db, tenantId, async (tx) =>
      userRepository(tx).bySubjectId(subjectId),
    );

    expect(found).toBeNull();
  });

  it('cannot find a user by username under a different tenant context', async () => {
    const tenantA = newId();
    const tenantB = newId();
    const username = `carol-${newId()}`;

    await withTenant(app.db, tenantA, async (tx) => {
      await seedTenant(tx, tenantA);
      const subject = await subjectRepository(tx).create({ tenantId: tenantA, type: 'user' });
      await insertUserRow(tx, subject.id, tenantA, { username });
    });

    await withTenant(app.db, tenantB, async (tx) => seedTenant(tx, tenantB));

    const foundFromB = await withTenant(app.db, tenantB, async (tx) =>
      userRepository(tx).byUsername(username),
    );
    expect(foundFromB).toBeNull();

    const foundFromA = await withTenant(app.db, tenantA, async (tx) =>
      userRepository(tx).byUsername(username),
    );
    expect(foundFromA?.user.username).toBe(username);
  });

  it('cannot find a user by subject id under a different tenant context', async () => {
    const tenantA = newId();
    const tenantB = newId();

    const subjectId = await withTenant(app.db, tenantA, async (tx) => {
      await seedTenant(tx, tenantA);
      const subject = await subjectRepository(tx).create({ tenantId: tenantA, type: 'user' });
      await insertUserRow(tx, subject.id, tenantA, { email: 'carol@example.com' });
      return subject.id;
    });

    await withTenant(app.db, tenantB, async (tx) => seedTenant(tx, tenantB));

    const foundFromB = await withTenant(app.db, tenantB, async (tx) =>
      userRepository(tx).bySubjectId(subjectId),
    );
    expect(foundFromB).toBeNull();

    const foundFromA = await withTenant(app.db, tenantA, async (tx) =>
      userRepository(tx).bySubjectId(subjectId),
    );
    expect(foundFromA?.email).toBe('carol@example.com');
  });

  it('refuses a user whose tenant differs from its subject', async () => {
    const tenantA = newId();
    const tenantB = newId();

    let error: unknown;
    try {
      await withTenant(app.db, tenantA, async (tx) => {
        await seedTenant(tx, tenantA);
      });
      await withTenant(app.db, tenantB, async (tx) => {
        await seedTenant(tx, tenantB);
      });

      const subjectId = await withTenant(app.db, tenantA, async (tx) => {
        const subject = await subjectRepository(tx).create({ tenantId: tenantA, type: 'user' });
        return subject.id;
      });

      // The subject belongs to tenantA; inserting the user row under tenantB
      // must be rejected by the composite foreign key, not silently allowed.
      await withTenant(app.db, tenantB, async (tx) => {
        await insertUserRow(tx, subjectId, tenantB);
      });
      expect.unreachable('expected the tenant-mismatched user insert to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('users_subject_tenant_fk');
  });

  it('cannot change an email under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await insertUserRow(tx, subject.id, tenantId, { email: 'carol@example.com' });
        return subject.id;
      },
      verifySeeded: async (tx, subjectId) => {
        const found = await userRepository(tx).bySubjectId(subjectId);
        expect(found?.email).toBe('carol@example.com');
      },
      attempt: async (tx, subjectId) => {
        try {
          await userRepository(tx).updateEmail(subjectId, 'attacker@example.com');
          return 'succeeded';
        } catch {
          return 'blocked';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('blocked');
      },
      verifyTenantAUnaffected: async (tx, subjectId) => {
        const found = await userRepository(tx).bySubjectId(subjectId);
        expect(found?.email).toBe('carol@example.com');
      },
    });
  });
});

// The repository guard constrains one writer. The column constrains every
// writer there will ever be, which is what the OIDC Core §5.1 row claims.
describe('users_email_addr_spec, the column constraint behind the email claim', () => {
  it('refuses a non-conforming address inserted straight into the table', async () => {
    const tenantId = newId();

    await expect(
      withTenant(app.db, tenantId, async (tx) => {
        await seedTenant(tx, tenantId);
        const subjectId = await insertSubject(tx, tenantId);
        await insertUserRow(tx, subjectId, tenantId, { email: 'not an address' });
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

    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
    });

    // One transaction per case: a constraint violation aborts the
    // transaction it happens in, and every statement after it in that
    // transaction fails for a reason that has nothing to do with the address.
    const accepted: boolean[] = [];
    for (const candidate of cases) {
      accepted.push(
        await withTenant(app.db, tenantId, async (tx) => {
          const subjectId = await insertSubject(tx, tenantId);
          await insertUserRow(tx, subjectId, tenantId, { email: candidate });
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
    const tenantId = newId();

    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await tx.insert(userCredentials).values({
        id: newId(),
        tenantId,
        subjectId: subject.id,
        type: 'password',
        secretData: { hash: '$argon2id$fake-hash' },
      });
      return subject.id;
    });

    const password = await withTenant(app.db, tenantId, async (tx) =>
      credentialRepository(tx).passwordFor(subjectId),
    );

    expect(password).toBe('$argon2id$fake-hash');
  });

  it('returns null when no credential matches', async () => {
    const tenantId = newId();

    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return subject.id;
    });

    const password = await withTenant(app.db, tenantId, async (tx) =>
      credentialRepository(tx).passwordFor(subjectId),
    );

    expect(password).toBeNull();
  });

  it('finds no password credential under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await tx.insert(userCredentials).values({
          id: newId(),
          tenantId,
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
    const tenantId = newId();

    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: subject.id,
        type: 'password',
        secret: { kind: 'password', hash: '$argon2id$old-hash' },
      });
      return subject.id;
    });

    await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).setPassword(subjectId, '$argon2id$new-hash'),
    );

    const password = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).passwordFor(subjectId),
    );
    expect(password).toBe('$argon2id$new-hash');
  });

  it('refuses to set a password with no existing credential row', async () => {
    const tenantId = newId();

    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return subject.id;
    });

    const failure = withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).setPassword(subjectId, '$argon2id$new-hash'),
    );
    await expect(failure).rejects.toThrow(OduduError);
    await expect(failure).rejects.toMatchObject({ code: 'credential_not_found' });
  });

  it('cannot replace a password credential under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await tx.insert(userCredentials).values({
          id: newId(),
          tenantId,
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
      verifyTenantAUnaffected: async (tx, subjectId) => {
        const password = await credentialRepository(tx).passwordFor(subjectId);
        expect(password).toBe('$argon2id$fake-hash');
      },
    });
  });

  it('retires the displaced hash and keeps only the depth asked for', async () => {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await credentialRepository(tx).insert({
        tenantId,
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
      const rotated = await withTenant(app.db, tenantId, (tx) =>
        credentialRepository(tx).rotatePassword(subjectId, { from, to }, 2),
      );
      expect(rotated).toBe(true);
    }

    const state = await withTenant(app.db, tenantId, async (tx) => ({
      current: await credentialRepository(tx).passwordFor(subjectId),
      history: await credentialRepository(tx).passwordHistory(subjectId),
    }));
    expect(state.current).toBe('$argon2id$four');
    expect(state.history).toEqual(['$argon2id$three', '$argon2id$two']);
  });

  // The write is the decision, not a record of one: a rotation against a
  // hash that is no longer in force archives nothing and reports it.
  it('refuses a rotation whose outgoing hash has already been replaced', async () => {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      await credentialRepository(tx).insert({
        tenantId,
        subjectId: subject.id,
        type: 'password',
        secret: { kind: 'password', hash: '$argon2id$one' },
      });
      return subject.id;
    });

    const stale = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).rotatePassword(
        subjectId,
        { from: '$argon2id$never-was', to: '$argon2id$two' },
        4,
      ),
    );

    expect(stale).toBe(false);
    const after = await withTenant(app.db, tenantId, async (tx) => ({
      current: await credentialRepository(tx).passwordFor(subjectId),
      history: await credentialRepository(tx).passwordHistory(subjectId),
    }));
    expect(after).toEqual({ current: '$argon2id$one', history: [] });
  });

  it('reads no password history under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await tx.insert(userCredentials).values({
          id: newId(),
          tenantId,
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

  it('cannot rotate a password under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await tx.insert(userCredentials).values({
          id: newId(),
          tenantId,
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
      verifyTenantAUnaffected: async (tx, subjectId) => {
        expect(await credentialRepository(tx).passwordFor(subjectId)).toBe('$argon2id$fake-hash');
        expect(await credentialRepository(tx).passwordHistory(subjectId)).toEqual([]);
      },
    });
  });
});

describe('userRepository.claimSelfRegistered', () => {
  async function seedUser(tx: TenantScopedDatabase, tenantId: string, selfRegistered: boolean) {
    await seedTenant(tx, tenantId);
    const subjectId = await insertSubject(tx, tenantId);
    await insertUserRow(tx, subjectId, tenantId, { email: 'ada@example.test', selfRegistered });
    return subjectId;
  }

  it('verifies the address once, for a self-registered account, and only for the mailed address', async () => {
    const tenantId = newId();
    const result = await withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedUser(tx, tenantId, true);
      const users = userRepository(tx);
      const other = await users.claimSelfRegistered(subjectId, 'else@example.test');
      const first = await users.claimSelfRegistered(subjectId, 'ada@example.test');
      const second = await users.claimSelfRegistered(subjectId, 'ada@example.test');
      return { other, first, second, user: await users.bySubjectId(subjectId) };
    });
    expect([result.other, result.first, result.second]).toEqual([false, true, false]);
    expect(result.user?.emailVerified).toBe(true);
  });

  it('stops being claimable once the address is verified through the mailed link', async () => {
    const tenantId = newId();
    const claimed = await withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedUser(tx, tenantId, true);
      await userRepository(tx).markEmailVerified(subjectId);
      await tx.update(users).set({ emailVerified: false }).where(eq(users.subjectId, subjectId));
      return userRepository(tx).claimSelfRegistered(subjectId, 'ada@example.test');
    });
    expect(claimed).toBe(false);
  });

  it('does nothing for an account that did not register itself', async () => {
    const tenantId = newId();
    const claimed = await withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedUser(tx, tenantId, false);
      return userRepository(tx).claimSelfRegistered(subjectId, 'ada@example.test');
    });
    expect(claimed).toBe(false);
  });

  it("cannot claim a foreign tenant's account", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: (tx, tenantId) => seedUser(tx, tenantId, true),
      verifySeeded: async (tx, subjectId) => {
        expect((await userRepository(tx).bySubjectId(subjectId))?.emailVerified).toBe(false);
      },
      attempt: async (tx, subjectId) =>
        userRepository(tx).claimSelfRegistered(subjectId, 'ada@example.test'),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
      verifyTenantAUnaffected: async (tx, subjectId) => {
        expect((await userRepository(tx).bySubjectId(subjectId))?.emailVerified).toBe(false);
      },
    });
  });
});

describe('credentialRepository.deleteSecondFactors', () => {
  async function seedFactors(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
    await seedTenant(tx, tenantId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const credentials = [
      ['password', { hash: 'h' }],
      ['password-history', { hash: 'old' }],
      ['totp', { secret: 'JBSWY3DPEHPK3PXP', digits: 6, lastStep: 0 }],
      ['webauthn', { publicKey: 'cHVi', counter: 0, transports: [] }],
      ['recovery-code', { hash: 'c1' }],
      ['recovery-code', { hash: 'c2', usedAt: '2026-01-01T00:00:00.000Z' }],
    ] as const;
    for (const [type, secretData] of credentials) {
      await tx.insert(userCredentials).values({
        id: newId(),
        tenantId,
        subjectId: subject.id,
        type,
        secretData,
        ...(type === 'webauthn' ? { lookupKey: `k-${newId()}` } : {}),
      });
    }
    return subject.id;
  }

  async function typesOf(tx: TenantScopedDatabase, subjectId: string): Promise<string[]> {
    const rows = await tx
      .select({ type: userCredentials.type })
      .from(userCredentials)
      .where(eq(userCredentials.subjectId, subjectId));
    return rows.map((row) => row.type).sort();
  }

  it('removes the one-time-code, passkey and recovery-code rows and keeps the password', async () => {
    const tenantId = newId();
    const result = await withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedFactors(tx, tenantId);
      const removed = await credentialRepository(tx).deleteSecondFactors(subjectId);
      return { removed, left: await typesOf(tx, subjectId) };
    });
    expect(result.removed).toBe(4);
    expect(result.left).toEqual(['password', 'password-history']);
  });

  it("cannot delete a foreign tenant's factors", async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedFactors,
      verifySeeded: async (tx, subjectId) => {
        expect(await credentialRepository(tx).listFor(subjectId, 'totp')).toHaveLength(1);
      },
      attempt: async (tx, subjectId) => credentialRepository(tx).deleteSecondFactors(subjectId),
      expectBlocked: (result) => {
        expect(result).toBe(0);
      },
      verifyTenantAUnaffected: async (tx, subjectId) => {
        expect(await credentialRepository(tx).listFor(subjectId, 'totp')).toHaveLength(1);
        expect(await credentialRepository(tx).listFor(subjectId, 'webauthn')).toHaveLength(1);
        expect(await credentialRepository(tx).listFor(subjectId, 'recovery-code')).toHaveLength(2);
      },
    });
  });
});

describe('credentialRepository.recoveryStanding', () => {
  async function seedStanding(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
    await seedTenant(tx, tenantId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const credentials = credentialRepository(tx);
    const base = { tenantId, subjectId: subject.id };
    await credentials.insert({
      ...base,
      type: 'webauthn',
      secret: { kind: 'webauthn', publicKey: 'AAAA', counter: 0, transports: [] },
      lookupKey: `key-${newId()}`,
    });
    await credentials.insert({
      ...base,
      type: 'recovery-code',
      secret: { kind: 'recovery-code', hash: 'h1' },
    });
    await credentials.insert({
      ...base,
      type: 'recovery-code',
      secret: { kind: 'recovery-code', hash: 'h2', usedAt: '2031-01-01T00:00:00.000Z' },
    });
    return subject.id;
  }

  it('counts held and unspent codes, and counts a passkey as no TOTP', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      const subjectId = await seedStanding(tx, tenantId);
      expect(await credentialRepository(tx).recoveryStanding(subjectId)).toEqual({
        unspent: 1,
        held: 2,
        hasTotp: false,
      });
      await credentialRepository(tx).insert({
        tenantId,
        subjectId,
        type: 'totp',
        secret: { kind: 'totp', secret: 'GEZDGNBVGY3TQOJQ', digits: 6, lastStep: 0 },
      });
      expect((await credentialRepository(tx).recoveryStanding(subjectId)).hasTotp).toBe(true);
    });
  });

  it('sees nothing of another tenant’s subject', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => seedStanding(tx, tenantId),
      verifySeeded: async (tx, subjectId) => {
        expect((await credentialRepository(tx).recoveryStanding(subjectId)).held).toBe(2);
      },
      attempt: async (tx, subjectId) => credentialRepository(tx).recoveryStanding(subjectId),
      expectBlocked: (result) => {
        expect(result).toEqual({ unspent: 0, held: 0, hasTotp: false });
      },
    });
  });
});

describe('subjectRepository recovery-set marker', () => {
  const T0 = new Date('2032-01-01T12:00:00.000Z');
  const HOUR = 3_600_000;
  const cutoff = (now: Date): Date => new Date(now.getTime() - HOUR);

  async function seedSubject(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
    await seedTenant(tx, tenantId);
    return (await subjectRepository(tx).create({ tenantId, type: 'user' })).id;
  }

  it('claims a subject that has never been issued a set, and records when', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      const id = await seedSubject(tx, tenantId);
      const subjects = subjectRepository(tx);
      expect(await subjects.recoveryIssuedAt(id)).toBeNull();
      expect(await subjects.claimRecoveryIssue(id, T0, cutoff(T0), false)).toBe(true);
      expect(await subjects.recoveryIssuedAt(id)).toEqual(T0);
    });
  });

  it('refuses a second claim inside the hour and leaves the marker alone', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      const id = await seedSubject(tx, tenantId);
      const subjects = subjectRepository(tx);
      await subjects.claimRecoveryIssue(id, T0, cutoff(T0), false);
      const later = new Date(T0.getTime() + HOUR - 1);
      expect(await subjects.claimRecoveryIssue(id, later, cutoff(later), false)).toBe(false);
      expect(await subjects.recoveryIssuedAt(id)).toEqual(T0);
    });
  });

  it('claims again an hour on, and inside the hour when the set is used up', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      const id = await seedSubject(tx, tenantId);
      const subjects = subjectRepository(tx);
      await subjects.claimRecoveryIssue(id, T0, cutoff(T0), false);
      const soon = new Date(T0.getTime() + 1000);
      expect(await subjects.claimRecoveryIssue(id, soon, cutoff(soon), true)).toBe(true);
      const later = new Date(soon.getTime() + HOUR);
      expect(await subjects.claimRecoveryIssue(id, later, cutoff(later), false)).toBe(true);
      expect(await subjects.recoveryIssuedAt(id)).toEqual(later);
    });
  });

  it('claims nothing of another tenant’s subject and reads no time for it', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const id = await seedSubject(tx, tenantId);
        await subjectRepository(tx).claimRecoveryIssue(id, T0, cutoff(T0), false);
        return id;
      },
      verifySeeded: async (tx, id) => {
        expect(await subjectRepository(tx).recoveryIssuedAt(id)).toEqual(T0);
      },
      attempt: async (tx, id) => ({
        read: await subjectRepository(tx).recoveryIssuedAt(id),
        claimed: await subjectRepository(tx).claimRecoveryIssue(id, T0, cutoff(T0), true),
      }),
      expectBlocked: (result) => {
        expect(result).toEqual({ read: null, claimed: false });
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
  async function seedFailures(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
    await seedTenant(tx, tenantId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await loginFailureRepository(tx).recordFailure(subject.id, POLICY, AT);
    await loginFailureRepository(tx).recordFailure(subject.id, POLICY, AT);
    return subject.id;
  }

  // The retry behind the compare-and-swap, from the inside: every one of six
  // concurrent writers has to end `recorded`, not merely leave the count at
  // six. A writer that gave up would be an attempt nobody counted, and the
  // count alone cannot tell that apart from a writer that won.
  it('records every concurrent failure rather than giving one of them up', async () => {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenant(tx, tenantId);
      const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
      return subject.id;
    });

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        withTenant(app.db, tenantId, (tx) =>
          loginFailureRepository(tx).recordFailure(subjectId, { ...POLICY, maxFailures: 20 }, AT),
        ),
      ),
    );

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(Array(6).fill('recorded'));
    expect(
      await withTenant(app.db, tenantId, (tx) => loginFailureRepository(tx).forSubject(subjectId)),
    ).toMatchObject({ failureCount: 6 });
  });

  it('reads no failure count under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
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

  it('cannot record a failure against another tenant’s subject', async () => {
    await expectCrossTenantMethodProbe(app.db, {
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
      // A cross-tenant write that locked somebody out would be a denial of
      // service on an account in a tenant the caller cannot even read.
      verifyTenantAUnaffected: async (tx, subjectId) => {
        expect(await loginFailureRepository(tx).forSubject(subjectId)).toMatchObject({
          failureCount: 3,
        });
      },
    });
  });

  it('cannot clear another tenant’s failure count', async () => {
    await expectCrossTenantMethodProbe(app.db, {
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
      // The one that matters most: clearing across tenants would let anybody
      // with a tenant of their own unlock an account in somebody else's.
      verifyTenantAUnaffected: async (tx, subjectId) => {
        expect(await loginFailureRepository(tx).forSubject(subjectId)).toMatchObject({
          failureCount: 2,
        });
      },
    });
  });
});

describe('tenant isolation', () => {
  it.each(['subjects', 'users', 'user_credentials', 'login_failures'])(
    'isolates %s by tenant',
    async (table) => {
      await expectTenantIsolation(app.db, {
        table,
        seed: async (tx, tenantId) => {
          await seedTenant(tx, tenantId);
          const subjectId = await insertSubject(tx, tenantId);
          if (table === 'users') {
            await insertUserRow(tx, subjectId, tenantId);
          } else if (table === 'user_credentials') {
            await tx.insert(userCredentials).values({
              id: newId(),
              tenantId,
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
