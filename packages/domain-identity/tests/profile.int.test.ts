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
import { userRepository, type ProfileUpdate } from '#/repository/users';
import { isValidBirthdate, isValidLocale, isValidZoneinfo } from '#/service/profile';

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

  it('[OIDC-CORE-5.1-02] refuses a verified phone number that is not E.164', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    expect(
      await causeMessage(
        withRealm(app.db, realmId, (tx) =>
          userRepository(tx).updateProfile(subjectId, {
            phoneNumber: '(415) 555-2671',
            phoneNumberVerified: true,
          }),
        ),
      ),
    ).toContain('users_verified_phone_is_e164');
  });

  it('[OIDC-CORE-5.1-03] refuses a verified phone number whose extension is not RFC 3966 digits', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    expect(
      await causeMessage(
        withRealm(app.db, realmId, (tx) =>
          userRepository(tx).updateProfile(subjectId, {
            phoneNumber: '+14155552671;ext=abc',
            phoneNumberVerified: true,
          }),
        ),
      ),
    ).toContain('users_verified_phone_is_e164');
  });

  it('refuses a verified phone number that is null, the same clause a formatted one violates', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    expect(
      await causeMessage(
        withRealm(app.db, realmId, (tx) =>
          userRepository(tx).updateProfile(subjectId, { phoneNumberVerified: true }),
        ),
      ),
    ).toContain('users_verified_phone_is_e164');
  });

  it('accepts a verified E.164 phone number with an RFC 3966 extension', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    await expect(
      withRealm(app.db, realmId, (tx) =>
        userRepository(tx).updateProfile(subjectId, {
          phoneNumber: '+14155552671;ext=123',
          phoneNumberVerified: true,
        }),
      ),
    ).resolves.toBeDefined();
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

  it('does not stamp profileUpdatedAt when the patch changes nothing', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    const first = await withRealm(app.db, realmId, (tx) =>
      userRepository(tx).updateProfile(subjectId, { nickname: 'ally' }),
    );
    expect(first.profileUpdatedAt).toBeInstanceOf(Date);

    const resubmitted = await withRealm(app.db, realmId, (tx) =>
      userRepository(tx).updateProfile(subjectId, { nickname: 'ally' }),
    );
    expect(resubmitted.profileUpdatedAt).toEqual(first.profileUpdatedAt);
  });
});

describe('markEmailVerified', () => {
  it('flips emailVerified for the named user', async () => {
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    const updated = await withRealm(app.db, realmId, (tx) =>
      userRepository(tx).markEmailVerified(subjectId),
    );
    expect(updated.emailVerified).toBe(true);

    const reread = await withRealm(app.db, realmId, (tx) =>
      userRepository(tx).bySubjectId(subjectId),
    );
    expect(reread?.emailVerified).toBe(true);
  });

  it('cannot verify a user in another realm', async () => {
    const realmA = newId();
    const realmB = newId();
    const subjectInA = await withRealm(app.db, realmA, (tx) => seedUser(tx, realmA));
    await withRealm(app.db, realmB, (tx) => seedRealm(tx, realmB));

    await expect(
      withRealm(app.db, realmB, (tx) => userRepository(tx).markEmailVerified(subjectInA)),
    ).rejects.toThrow(/not found/);

    const stillA = await withRealm(app.db, realmA, (tx) =>
      userRepository(tx).bySubjectId(subjectInA),
    );
    expect(stillA?.emailVerified).toBe(false);
  });
});

// One transaction per case: a CHECK violation aborts the transaction it
// happens in, so an update attempted after one in the same transaction
// fails for a reason unrelated to the value under test.
async function acceptedByColumn(
  realmId: string,
  subjectId: string,
  field: keyof ProfileUpdate,
  value: string,
): Promise<boolean> {
  return withRealm(app.db, realmId, (tx) =>
    userRepository(tx).updateProfile(subjectId, { [field]: value }),
  ).then(
    () => true,
    () => false,
  );
}

// Migration 0012's precedent (isEmailAddress vs. users_email_addr_spec,
// held together by identity.int.test.ts's parity assertion): a predicate
// and the CHECK it mirrors are two spellings of one rule, and only running
// the same cases through both catches the day they drift.
describe('SQL/TypeScript parity for the shape-constrained columns', () => {
  it('users_birthdate_shape accepts exactly what isValidBirthdate accepts', async () => {
    const cases = ['1990-01-31', '1990', '0000', '90-01-31', '1990-1-1', '31/01/1990', ''];
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    const accepted: boolean[] = [];
    for (const candidate of cases) {
      accepted.push(await acceptedByColumn(realmId, subjectId, 'birthdate', candidate));
    }

    expect(Object.fromEntries(cases.map((c, i) => [c, accepted[i]]))).toEqual(
      Object.fromEntries(cases.map((c) => [c, isValidBirthdate(c)])),
    );
  });

  it('users_locale_shape accepts exactly what isValidLocale accepts', async () => {
    const cases = ['en', 'en-US', 'zh-Hans-CN', 'en_US', 'english', ''];
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    const accepted: boolean[] = [];
    for (const candidate of cases) {
      accepted.push(await acceptedByColumn(realmId, subjectId, 'locale', candidate));
    }

    expect(Object.fromEntries(cases.map((c, i) => [c, accepted[i]]))).toEqual(
      Object.fromEntries(cases.map((c) => [c, isValidLocale(c)])),
    );
  });

  it('users_zoneinfo_shape accepts exactly what isValidZoneinfo accepts', async () => {
    const cases = [
      'Europe/London',
      'UTC',
      'America/Argentina/Buenos_Aires',
      'not a zone',
      '/leading',
      '',
    ];
    const realmId = newId();
    const subjectId = await withRealm(app.db, realmId, (tx) => seedUser(tx, realmId));

    const accepted: boolean[] = [];
    for (const candidate of cases) {
      accepted.push(await acceptedByColumn(realmId, subjectId, 'zoneinfo', candidate));
    }

    expect(Object.fromEntries(cases.map((c, i) => [c, accepted[i]]))).toEqual(
      Object.fromEntries(cases.map((c) => [c, isValidZoneinfo(c)])),
    );
  });
});
