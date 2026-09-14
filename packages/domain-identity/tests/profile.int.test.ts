import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { subjectRepository } from '#/repository/subjects';
import { userRepository } from '#/repository/users';

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

// The driver only carries the fired constraint's name on the query error's
// `.cause.message`, not on the top-level message `.rejects.toThrow` reads —
// see roles.int.test.ts's causeMessage in packages/domain-authz/tests.
async function causeMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (caught) {
    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    return (cause as Error).message;
  }
  expect.unreachable('expected the promise to reject');
}

async function seedUser(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  await seedRealm(tx, realmId);
  const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
  await userRepository(tx).create({
    subjectId: subject.id,
    realmId,
    username: `user-${newId()}`,
  });
  return subject.id;
}

describe('the database enforces what the claim promises', () => {
  it.each([['31/01/1990'], ['1990-1-1']])('refuses birthdate %s', async (birthdate) => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    expect(
      await causeMessage(
        withRealm(app.db, realmId, (tx) =>
          userRepository(tx).updateProfile(subjectId, { birthdate }),
        ),
      ),
    ).toContain('users_birthdate_shape');
  });

  it('refuses a locale the shape does not admit', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    expect(
      await causeMessage(
        withRealm(app.db, realmId, (tx) =>
          userRepository(tx).updateProfile(subjectId, { locale: 'en_US' }),
        ),
      ),
    ).toContain('users_locale_shape');
  });

  it('refuses a zoneinfo the shape does not admit', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    expect(
      await causeMessage(
        withRealm(app.db, realmId, (tx) =>
          userRepository(tx).updateProfile(subjectId, { zoneinfo: '+1' }),
        ),
      ),
    ).toContain('users_zoneinfo_shape');
  });

  it('accepts a phone number in any format, since E.164 is only recommended', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    for (const phoneNumber of ['+14155552671', '(415) 555-2671', '0415 555 2671']) {
      await expect(
        withRealm(app.db, realmId, (tx) =>
          userRepository(tx).updateProfile(subjectId, { phoneNumber }),
        ),
      ).resolves.toBeDefined();
    }
  });

  it('refuses a profile URL that is not http or https', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    expect(
      await causeMessage(
        withRealm(app.db, realmId, (tx) =>
          userRepository(tx).updateProfile(subjectId, { picture: 'javascript:alert(1)' }),
        ),
      ),
    ).toContain('users_profile_urls_are_http');
  });

  it('accepts a birthdate holding only the year, and 0000 for a withheld year', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    for (const birthdate of ['1990', '0000']) {
      const updated = await withRealm(app.db, realmId, (tx) =>
        userRepository(tx).updateProfile(subjectId, { birthdate }),
      );
      expect(updated.birthdate).toBe(birthdate);
    }
  });

  it('stamps profileUpdatedAt on every update', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    const updated = await withRealm(app.db, realmId, (tx) =>
      userRepository(tx).updateProfile(subjectId, { nickname: 'x' }),
    );

    expect(updated.profileUpdatedAt).toBeInstanceOf(Date);
  });

  it('updates every OIDC Core §5.1 field it accepts and reads them back', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    const patch = {
      name: 'Alice Adams',
      givenName: 'Alice',
      familyName: 'Adams',
      middleName: 'Beatrix',
      nickname: 'Ally',
      preferredUsername: 'alice',
      profile: 'https://example.com/alice',
      picture: 'https://example.com/alice.png',
      website: 'https://alice.example.com',
      gender: 'female',
      birthdate: '1990-01-31',
      zoneinfo: 'America/New_York',
      locale: 'en-US',
      phoneNumber: '+14155552671',
      phoneNumberVerified: true,
      addressFormatted: '123 Main St, Anytown',
      addressStreet: '123 Main St',
      addressLocality: 'Anytown',
      addressRegion: 'CA',
      addressPostalCode: '90210',
      addressCountry: 'US',
    };

    const updated = await withRealm(app.db, realmId, (tx) =>
      userRepository(tx).updateProfile(subjectId, patch),
    );

    expect(updated).toMatchObject(patch);
  });

  it('updates no profile in another realm', async () => {
    const realmA = newId();
    const realmB = newId();
    const subjectInA = await withRealm(app.db, realmA, (tx) => seedUser(tx, realmA));
    await withRealm(app.db, realmB, (tx) => seedRealm(tx, realmB));

    await expect(
      withRealm(app.db, realmB, (tx) =>
        userRepository(tx).updateProfile(subjectInA, { nickname: 'x' }),
      ),
    ).rejects.toThrow(/not found/);

    const stillA = await withRealm(app.db, realmA, (tx) =>
      userRepository(tx).bySubjectId(subjectInA),
    );
    expect(stillA?.nickname).toBeNull();
  });
});
