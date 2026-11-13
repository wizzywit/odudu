import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { subjectRepository, userRepository, users } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requiredActionRepository } from '#/repository/required-actions';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { termsAcceptanceRepository } from '#/repository/terms-acceptances';
import { completeAcceptTerms, termsOffer } from '#/usecase/accept-terms-action';
import { pendingActionsFor } from '#/usecase/pending-actions';
import { completeUpdateProfile, profileOffer } from '#/usecase/update-profile-action';
import { completeVerifyEmail, verifyEmailOffer } from '#/usecase/verify-email-action';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

interface Seed {
  tenantId: string;
  subjectId: string;
}

async function seed(
  tx: TenantScopedDatabase,
  tenantId: string,
  options: {
    email?: string | null;
    verified?: boolean;
    termsUri?: string | null;
    termsVersion?: string;
    usernameEditable?: boolean;
    requiredProfileFields?: string[];
  } = {},
): Promise<Seed> {
  await tx.insert(tenants).values({
    id: tenantId,
    name: `t-${tenantId}`,
    termsUri: options.termsUri ?? null,
    termsVersion: options.termsVersion ?? '1',
    usernameEditable: options.usernameEditable ?? false,
    ...(options.requiredProfileFields === undefined
      ? {}
      : { requiredProfileFields: options.requiredProfileFields }),
  });
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await tx.insert(users).values({
    subjectId: subject.id,
    tenantId,
    username: 'ada',
    email: options.email === undefined ? 'ada@example.com' : options.email,
    emailVerified: options.verified ?? false,
  });
  return { tenantId, subjectId: subject.id };
}

async function owing(
  options: Parameters<typeof seed>[2],
  actions: readonly ('verify-email' | 'update-profile' | 'accept-terms')[],
): Promise<Seed> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, async (tx) => {
    const made = await seed(tx, tenantId, options);
    for (const action of actions) {
      await requiredActionRepository(tx).add(made.tenantId, made.subjectId, action);
    }
    return made;
  });
}

// A tenant is its own context: rows of `seed` live under the tenant it created,
// so every later read runs under that tenant id.
function inTenant<T>(made: Seed, run: (tx: TenantScopedDatabase) => Promise<T>): Promise<T> {
  return withTenant(app.db, made.tenantId, run);
}

async function ownerRows(made: Seed): Promise<string[]> {
  return inTenant(made, (tx) => requiredActionRepository(tx).pendingFor(made.subjectId));
}

describe('the terms acceptance record', () => {
  it('holds the version a subject accepted, and no other', async () => {
    const made = await owing({ termsUri: 'https://example.com/terms' }, []);
    await inTenant(made, async (tx) => {
      const terms = termsAcceptanceRepository(tx);
      expect(await terms.hasAccepted(made.subjectId, '1')).toBe(false);
      await terms.accept(made.tenantId, made.subjectId, '1');
      await terms.accept(made.tenantId, made.subjectId, '1');
      expect(await terms.hasAccepted(made.subjectId, '1')).toBe(true);
      expect(await terms.hasAccepted(made.subjectId, '2')).toBe(false);
    });
  });

  it('lists a subject’s acceptances newest first, in pages by keyset', async () => {
    const made = await owing({ termsUri: 'https://example.com/terms' }, []);
    await inTenant(made, async (tx) => {
      const terms = termsAcceptanceRepository(tx);
      await terms.accept(made.tenantId, made.subjectId, 'a', new Date('2026-01-01T00:00:00Z'));
      await terms.accept(made.tenantId, made.subjectId, 'c', new Date('2026-03-01T00:00:00Z'));
      await terms.accept(made.tenantId, made.subjectId, 'b', new Date('2026-03-01T00:00:00Z'));
      const first = await terms.recent(made.subjectId, { after: undefined, limit: 2 });
      expect(first.map((row) => row.version)).toEqual(['c', 'b']);
      const last = first[1];
      if (last === undefined) throw new Error('no row');
      const rest = await terms.recent(made.subjectId, {
        after: { acceptedAt: last.acceptedAt, version: last.version },
        limit: 2,
      });
      expect(rest.map((row) => row.version)).toEqual(['a']);
    });
  });

  it('does not list another tenant’s subject', async () => {
    const own = await owing({}, []);
    const other = await owing({}, []);
    await inTenant(own, (tx) =>
      termsAcceptanceRepository(tx).accept(own.tenantId, own.subjectId, '1'),
    );
    const seen = await inTenant(other, (tx) =>
      termsAcceptanceRepository(tx).recent(own.subjectId, { after: undefined, limit: 10 }),
    );
    expect(seen).toEqual([]);
  });

  it('is not read by another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `t-${tenantId}` });
        const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
        await termsAcceptanceRepository(tx).accept(tenantId, subject.id, '1');
        return subject.id;
      },
      verifySeeded: async (tx, subjectId) => {
        expect(await termsAcceptanceRepository(tx).hasAccepted(subjectId, '1')).toBe(true);
      },
      attempt: (tx, subjectId) => termsAcceptanceRepository(tx).hasAccepted(subjectId, '1'),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
    });
  });

  it('cannot be written for another tenant', async () => {
    const own = await owing({}, []);
    const other = await owing({}, []);
    await expect(
      inTenant(other, (tx) =>
        termsAcceptanceRepository(tx).accept(own.tenantId, own.subjectId, '1'),
      ),
    ).rejects.toThrow();
  });
});

describe('pendingActionsFor clears what no page could finish', () => {
  it('keeps verify-email for an address that is not proved yet', async () => {
    const made = await owing({ verified: false }, ['verify-email']);
    const owed = await inTenant(made, (tx) => pendingActionsFor(tx, made.tenantId, made.subjectId));
    expect(owed).toEqual(['verify-email']);
  });

  it('clears verify-email for a proved address and for none at all', async () => {
    const proved = await owing({ verified: true }, ['verify-email']);
    expect(
      await inTenant(proved, (tx) => pendingActionsFor(tx, proved.tenantId, proved.subjectId)),
    ).toEqual([]);
    expect(await ownerRows(proved)).toEqual([]);

    const none = await owing({ email: null }, ['verify-email']);
    expect(
      await inTenant(none, (tx) => pendingActionsFor(tx, none.tenantId, none.subjectId)),
    ).toEqual([]);
    expect(await ownerRows(none)).toEqual([]);
  });

  it('keeps accept-terms while the tenant has terms this subject has not accepted', async () => {
    const made = await owing({ termsUri: 'https://example.com/terms' }, ['accept-terms']);
    expect(
      await inTenant(made, (tx) => pendingActionsFor(tx, made.tenantId, made.subjectId)),
    ).toEqual(['accept-terms']);
  });

  it('clears accept-terms where the tenant has no terms or this version was accepted', async () => {
    const none = await owing({ termsUri: null }, ['accept-terms']);
    expect(
      await inTenant(none, (tx) => pendingActionsFor(tx, none.tenantId, none.subjectId)),
    ).toEqual([]);

    const accepted = await owing({ termsUri: 'https://example.com/terms' }, ['accept-terms']);
    await inTenant(accepted, (tx) =>
      termsAcceptanceRepository(tx).accept(accepted.tenantId, accepted.subjectId, '1'),
    );
    expect(
      await inTenant(accepted, (tx) =>
        pendingActionsFor(tx, accepted.tenantId, accepted.subjectId),
      ),
    ).toEqual([]);
    expect(await ownerRows(accepted)).toEqual([]);
  });

  it('asks again when an administrator owes the action for a version not yet accepted', async () => {
    const made = await owing({ termsUri: 'https://example.com/terms', termsVersion: '2' }, [
      'accept-terms',
    ]);
    await inTenant(made, (tx) =>
      termsAcceptanceRepository(tx).accept(made.tenantId, made.subjectId, '1'),
    );
    expect(
      await inTenant(made, (tx) => pendingActionsFor(tx, made.tenantId, made.subjectId)),
    ).toEqual(['accept-terms']);
  });

  it('leaves update-profile owed for the person to do', async () => {
    const made = await owing({}, ['update-profile']);
    expect(
      await inTenant(made, (tx) => pendingActionsFor(tx, made.tenantId, made.subjectId)),
    ).toEqual(['update-profile']);
  });
});

describe('verify-email', () => {
  it('offers the address held and whether it is proved', async () => {
    const made = await owing({ verified: false }, ['verify-email']);
    expect(await inTenant(made, (tx) => verifyEmailOffer(tx, made.subjectId))).toEqual({
      email: 'ada@example.com',
      verified: false,
    });
  });

  it('is not completed by saying so, and stays owed', async () => {
    const made = await owing({ verified: false }, ['verify-email']);
    expect(await inTenant(made, (tx) => completeVerifyEmail(tx, made.subjectId))).toEqual({
      kind: 'not_verified',
    });
    expect(await ownerRows(made)).toEqual(['verify-email']);
  });

  it('completes and clears its row once the address is proved', async () => {
    const made = await owing({ verified: false }, ['verify-email']);
    await inTenant(made, (tx) => userRepository(tx).markEmailVerified(made.subjectId));
    expect(await inTenant(made, (tx) => completeVerifyEmail(tx, made.subjectId))).toEqual({
      kind: 'verified',
    });
    expect(await ownerRows(made)).toEqual([]);
  });

  it('is not read for another tenant’s subject', async () => {
    const own = await owing({ verified: true }, []);
    const other = await owing({}, []);
    expect(await inTenant(other, (tx) => completeVerifyEmail(tx, own.subjectId))).toEqual({
      kind: 'not_verified',
    });
  });
});

const FILLED: Record<string, string> = {
  name: 'Ada Lovelace',
  given_name: 'Ada',
  family_name: 'Lovelace',
  middle_name: 'Augusta',
  nickname: 'ada',
  preferred_username: 'ada',
  profile: 'https://example.com/ada',
  picture: 'https://example.com/ada.png',
  website: 'https://example.com',
  gender: 'female',
  birthdate: '1815-12-10',
  zoneinfo: 'Europe/London',
  locale: 'en-GB',
  phone_number: '+442071838750',
  address_formatted: '12 St James Square, London',
  address_street: '12 St James Square',
  address_locality: 'London',
  address_region: 'Greater London',
  address_postal_code: 'SW1Y 4LB',
  address_country: 'GB',
};

function without(form: Record<string, string>, field: string): Record<string, string> {
  return Object.fromEntries(Object.entries(form).filter(([name]) => name !== field));
}

describe('update-profile', () => {
  it('offers every editable field with what the person holds', async () => {
    const made = await owing({}, ['update-profile']);
    await inTenant(made, (tx) => userRepository(tx).updateProfile(made.subjectId, { name: 'Ada' }));
    const offer = await inTenant(made, (tx) => profileOffer(tx, made.tenantId, made.subjectId));
    expect(offer.fields).toHaveLength(20);
    expect(offer.required).toEqual(['given_name', 'family_name']);
    expect(offer.values.name).toBe('Ada');
    expect(offer.values.birthdate).toBe('');
  });

  it('offers the username where the tenant lets one change', async () => {
    const made = await owing({ usernameEditable: true }, ['update-profile']);
    const offer = await inTenant(made, (tx) => profileOffer(tx, made.tenantId, made.subjectId));
    expect(offer.fields[0]).toBe('username');
    expect(offer.values.username).toBe('ada');
  });

  it('completes when every required field has a value, and clears its row', async () => {
    const made = await owing({ requiredProfileFields: Object.keys(FILLED) }, ['update-profile']);
    const outcome = await inTenant(made, (tx) =>
      completeUpdateProfile(tx, {
        tenantId: made.tenantId,
        subjectId: made.subjectId,
        posted: { ...FILLED, email: 'someone@else.example', unknown: 'x' },
      }),
    );
    expect(outcome).toEqual({ kind: 'completed' });
    expect(await ownerRows(made)).toEqual([]);
    const user = await inTenant(made, (tx) => userRepository(tx).bySubjectId(made.subjectId));
    expect(user?.birthdate).toBe('1815-12-10');
    expect(user?.addressCountry).toBe('GB');
    expect(user?.email).toBe('ada@example.com');
  });

  it('writes nothing and stays owed while a required field is left empty', async () => {
    const made = await owing({ requiredProfileFields: Object.keys(FILLED) }, ['update-profile']);
    const posted = without(FILLED, 'birthdate');
    const outcome = await inTenant(made, (tx) =>
      completeUpdateProfile(tx, { tenantId: made.tenantId, subjectId: made.subjectId, posted }),
    );
    expect(outcome).toMatchObject({
      kind: 'rejected',
      problems: [{ kind: 'unfilled', fields: ['birthdate'] }],
    });
    expect(await ownerRows(made)).toEqual(['update-profile']);
    const user = await inTenant(made, (tx) => userRepository(tx).bySubjectId(made.subjectId));
    expect(user?.name).toBeNull();
  });

  it('needs only the given and family name by default, and leaves the rest as they are', async () => {
    const made = await owing({}, ['update-profile']);
    const outcome = await inTenant(made, (tx) =>
      completeUpdateProfile(tx, {
        tenantId: made.tenantId,
        subjectId: made.subjectId,
        posted: { given_name: 'Ada', family_name: 'Lovelace', picture: '' },
      }),
    );
    expect(outcome).toEqual({ kind: 'completed' });
    expect(await ownerRows(made)).toEqual([]);
    const user = await inTenant(made, (tx) => userRepository(tx).bySubjectId(made.subjectId));
    expect(user?.givenName).toBe('Ada');
    expect(user?.picture).toBeNull();
  });

  it('asks a field it requires to be non-empty after the form, though it held a value', async () => {
    const made = await owing({ requiredProfileFields: ['name'] }, ['update-profile']);
    await inTenant(made, (tx) => userRepository(tx).updateProfile(made.subjectId, { name: 'Ada' }));
    const outcome = await inTenant(made, (tx) =>
      completeUpdateProfile(tx, {
        tenantId: made.tenantId,
        subjectId: made.subjectId,
        posted: { name: '  ' },
      }),
    );
    expect(outcome).toMatchObject({
      kind: 'rejected',
      problems: [{ kind: 'unfilled', fields: ['name'] }],
    });
    expect(await ownerRows(made)).toEqual(['update-profile']);
  });

  it('is a page reviewed and submitted when the tenant requires nothing', async () => {
    const made = await owing({ requiredProfileFields: [] }, ['update-profile']);
    const outcome = await inTenant(made, (tx) =>
      completeUpdateProfile(tx, { tenantId: made.tenantId, subjectId: made.subjectId, posted: {} }),
    );
    expect(outcome).toEqual({ kind: 'completed' });
    expect(await ownerRows(made)).toEqual([]);
  });

  it('names every invalid value at once', async () => {
    const made = await owing({}, ['update-profile']);
    const outcome = await inTenant(made, (tx) =>
      completeUpdateProfile(tx, {
        tenantId: made.tenantId,
        subjectId: made.subjectId,
        posted: { given_name: 'Ada', family_name: 'L', birthdate: 'x', zoneinfo: '+1' },
      }),
    );
    expect(outcome).toMatchObject({
      kind: 'rejected',
      problems: [
        { kind: 'invalid', field: 'birthdate' },
        { kind: 'invalid', field: 'zoneinfo' },
      ],
    });
  });

  it('clears the row of a subject that has no user row, so a sign-in does not loop', async () => {
    const made = await owing({}, ['update-profile']);
    await withTenant(app.db, made.tenantId, (tx) =>
      tx.delete(users).where(eq(users.subjectId, made.subjectId)),
    );
    const outcome = await inTenant(made, (tx) =>
      completeUpdateProfile(tx, { tenantId: made.tenantId, subjectId: made.subjectId, posted: {} }),
    );
    expect(outcome).toEqual({ kind: 'completed' });
    expect(await ownerRows(made)).toEqual([]);
  });

  it('refuses a value the me API would refuse, naming the field', async () => {
    const made = await owing({}, ['update-profile']);
    const outcome = await inTenant(made, (tx) =>
      completeUpdateProfile(tx, {
        tenantId: made.tenantId,
        subjectId: made.subjectId,
        posted: { ...FILLED, birthdate: '10/12/1815' },
      }),
    );
    expect(outcome).toMatchObject({
      kind: 'rejected',
      problems: [{ kind: 'invalid', field: 'birthdate', reason: 'shape' }],
    });
    expect(await ownerRows(made)).toEqual(['update-profile']);
  });

  it('does not require a field that is already filled to be sent again', async () => {
    const made = await owing({}, ['update-profile']);
    await inTenant(made, (tx) => userRepository(tx).updateProfile(made.subjectId, { name: 'Ada' }));
    const posted = without(FILLED, 'name');
    const outcome = await inTenant(made, (tx) =>
      completeUpdateProfile(tx, { tenantId: made.tenantId, subjectId: made.subjectId, posted }),
    );
    expect(outcome).toEqual({ kind: 'completed' });
    const user = await inTenant(made, (tx) => userRepository(tx).bySubjectId(made.subjectId));
    expect(user?.name).toBe('Ada');
  });

  it('changes the username only where the tenant lets it, and refuses one another holds', async () => {
    const free = await owing({ usernameEditable: true }, ['update-profile']);
    const renamed = await inTenant(free, (tx) =>
      completeUpdateProfile(tx, {
        tenantId: free.tenantId,
        subjectId: free.subjectId,
        posted: { ...FILLED, username: 'grace' },
      }),
    );
    expect(renamed).toEqual({ kind: 'completed' });
    expect(
      (await inTenant(free, (tx) => userRepository(tx).bySubjectId(free.subjectId)))?.username,
    ).toBe('grace');

    const fixed = await owing({ usernameEditable: false }, ['update-profile']);
    await inTenant(fixed, (tx) =>
      completeUpdateProfile(tx, {
        tenantId: fixed.tenantId,
        subjectId: fixed.subjectId,
        posted: { ...FILLED, username: 'grace' },
      }),
    );
    expect(
      (await inTenant(fixed, (tx) => userRepository(tx).bySubjectId(fixed.subjectId)))?.username,
    ).toBe('ada');

    const taken = await owing({ usernameEditable: true }, ['update-profile']);
    await inTenant(taken, async (tx) => {
      const other = await subjectRepository(tx).create({ tenantId: taken.tenantId, type: 'user' });
      await tx
        .insert(users)
        .values({ subjectId: other.id, tenantId: taken.tenantId, username: 'grace' });
    });
    const refused = await inTenant(taken, (tx) =>
      completeUpdateProfile(tx, {
        tenantId: taken.tenantId,
        subjectId: taken.subjectId,
        posted: { ...FILLED, username: 'grace' },
      }),
    );
    expect(refused).toMatchObject({ kind: 'rejected', problems: [{ kind: 'username_taken' }] });
  });

  it('refuses a username another person claims at the same moment, writing nothing of the form', async () => {
    const first = await owing({ usernameEditable: true }, ['update-profile']);
    const second = await withTenant(app.db, first.tenantId, async (tx) => {
      const subject = await subjectRepository(tx).create({
        tenantId: first.tenantId,
        type: 'user',
      });
      await tx
        .insert(users)
        .values({ subjectId: subject.id, tenantId: first.tenantId, username: 'grace-b' });
      await requiredActionRepository(tx).add(first.tenantId, subject.id, 'update-profile');
      return { tenantId: first.tenantId, subjectId: subject.id };
    });
    const submit = (made: Seed) =>
      inTenant(made, (tx) =>
        completeUpdateProfile(tx, {
          tenantId: made.tenantId,
          subjectId: made.subjectId,
          posted: { ...FILLED, username: 'ada-new' },
        }),
      );
    const outcomes = await Promise.all([submit(first), submit(second)]);
    expect(outcomes.filter((outcome) => outcome.kind === 'completed')).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.kind === 'rejected');
    expect(refused).toMatchObject({ problems: [{ kind: 'username_taken' }] });
    const loser = outcomes[0].kind === 'rejected' ? first : second;
    expect(await ownerRows(loser)).toEqual(['update-profile']);
    const row = await inTenant(loser, (tx) => userRepository(tx).bySubjectId(loser.subjectId));
    expect(row?.name).toBeNull();
  });

  it('records which fields changed and none of their values', async () => {
    const made = await owing({}, ['update-profile']);
    await inTenant(made, (tx) =>
      completeUpdateProfile(tx, {
        tenantId: made.tenantId,
        subjectId: made.subjectId,
        posted: FILLED,
      }),
    );
    const rows = await inTenant(made, (tx) =>
      tx.execute<{ action: string; detail: { fields: string[]; via: string } }>(
        sql`select action, detail from audit_events where resource_id = ${made.subjectId}`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('subject.profile_amend');
    expect(rows[0]?.detail.via).toBe('required_action');
    expect(rows[0]?.detail.fields).toContain('birthdate');
    expect(JSON.stringify(rows[0]?.detail)).not.toContain('1815');
  });
});

describe('accept-terms', () => {
  it('offers the address and the version', async () => {
    const made = await owing(
      { termsUri: 'https://example.com/terms', termsVersion: '2026-01' },
      [],
    );
    expect(await inTenant(made, (tx) => termsOffer(tx, made.tenantId))).toEqual({
      uri: 'https://example.com/terms',
      version: '2026-01',
    });
    const none = await owing({}, []);
    expect(await inTenant(none, (tx) => termsOffer(tx, none.tenantId))).toBeNull();
  });

  it('stores nothing and stays owed until the box is ticked', async () => {
    const made = await owing({ termsUri: 'https://example.com/terms' }, ['accept-terms']);
    const outcome = await inTenant(made, (tx) =>
      completeAcceptTerms(tx, {
        tenantId: made.tenantId,
        subjectId: made.subjectId,
        accepted: false,
        version: '1',
        now: new Date(),
      }),
    );
    expect(outcome).toEqual({ kind: 'not_accepted' });
    expect(await ownerRows(made)).toEqual(['accept-terms']);
    expect(
      await inTenant(made, (tx) => termsAcceptanceRepository(tx).hasAccepted(made.subjectId, '1')),
    ).toBe(false);
  });

  it('records the version in force, clears its row and audits the acceptance', async () => {
    const made = await owing({ termsUri: 'https://example.com/terms', termsVersion: '2026-01' }, [
      'accept-terms',
    ]);
    const outcome = await inTenant(made, (tx) =>
      completeAcceptTerms(tx, {
        tenantId: made.tenantId,
        subjectId: made.subjectId,
        accepted: true,
        version: '2026-01',
        now: new Date('2026-11-12T10:00:00Z'),
      }),
    );
    expect(outcome).toEqual({ kind: 'accepted' });
    expect(await ownerRows(made)).toEqual([]);
    expect(
      await inTenant(made, (tx) =>
        termsAcceptanceRepository(tx).hasAccepted(made.subjectId, '2026-01'),
      ),
    ).toBe(true);
    const audited = await inTenant(made, (tx) =>
      tx.execute<{ action: string; detail: { version: string } }>(
        sql`select action, detail from audit_events where resource_id = ${made.subjectId}`,
      ),
    );
    expect(audited.map((row) => row.action)).toEqual(['terms.accepted']);
    expect(audited[0]?.detail.version).toBe('2026-01');
  });

  it('records nothing when the version shown is not the one in force, or none was sent', async () => {
    const made = await owing({ termsUri: 'https://example.com/terms', termsVersion: '2' }, [
      'accept-terms',
    ]);
    for (const version of ['1', undefined]) {
      const outcome = await inTenant(made, (tx) =>
        completeAcceptTerms(tx, {
          tenantId: made.tenantId,
          subjectId: made.subjectId,
          accepted: true,
          version,
          now: new Date(),
        }),
      );
      expect(outcome).toEqual({ kind: 'stale' });
    }
    expect(await ownerRows(made)).toEqual(['accept-terms']);
    expect(
      await inTenant(made, (tx) => termsAcceptanceRepository(tx).hasAccepted(made.subjectId, '2')),
    ).toBe(false);
  });

  it('says so when the tenant has no terms', async () => {
    const made = await owing({}, ['accept-terms']);
    const outcome = await inTenant(made, (tx) =>
      completeAcceptTerms(tx, {
        tenantId: made.tenantId,
        subjectId: made.subjectId,
        accepted: true,
        version: '1',
        now: new Date(),
      }),
    );
    expect(outcome).toEqual({ kind: 'not_configured' });
  });

  it('does not duplicate a second acceptance', async () => {
    const made = await owing({ termsUri: 'https://example.com/terms' }, ['accept-terms']);
    const input = {
      tenantId: made.tenantId,
      subjectId: made.subjectId,
      accepted: true,
      version: '1',
      now: new Date(),
    };
    await inTenant(made, (tx) => completeAcceptTerms(tx, input));
    await inTenant(made, (tx) => completeAcceptTerms(tx, input));
    const count = await inTenant(made, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from subject_terms_acceptances where subject_id = ${made.subjectId}`,
      ),
    );
    expect(count[0]?.n).toBe(1);
  });
});

describe('the tenant row the actions read', () => {
  it('is not read for another tenant', async () => {
    const own = await owing({ termsUri: 'https://example.com/terms' }, []);
    const other = await owing({}, []);
    await expect(
      inTenant(other, (tx) => tenantSettingsRepository(tx).accountActionSettings(own.tenantId)),
    ).rejects.toThrow(/tenant_not_found|no tenant/u);
  });

  it('holds the terms where the settings put them', async () => {
    const made = await owing({ termsUri: 'https://example.com/terms' }, []);
    const [row] = await inTenant(made, (tx) =>
      tx.select().from(tenants).where(eq(tenants.id, made.tenantId)),
    );
    expect(row?.termsUri).toBe('https://example.com/terms');
    expect(row?.termsVersion).toBe('1');
  });
});
