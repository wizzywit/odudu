import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { auditRepository, type AuditEventRecord } from '@odudu/domain-audit';
import {
  type BreachedPasswordCheck,
  credentialRepository,
  hashPassword,
  breachedHash,
  createBreachedPasswordCheck,
  hashUserPassword,
  insertBreachedHashes,
  subjectRepository,
  userCredentials,
  users,
  verifyPassword,
} from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requiredActionRepository } from '#/repository/required-actions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { advance, startAuthentication, type AdvanceOutcome } from '#/usecase/executor';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import {
  completeUpdatePassword,
  prepareUpdatePassword,
  type UpdatePasswordOutcome,
} from '#/usecase/update-password';

// The dataset and no egress: a lookup the test did not expect fails loudly.
const breachedCheck = createBreachedPasswordCheck({
  fetchRange: () => Promise.reject(new Error('no remote lookup expected')),
});

const SILENT_LOGGER = { error: (): void => undefined };

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

const PASSWORD = 'correct horse battery staple';

interface TenantPolicy {
  maxAgeDays?: number;
  historyDepth?: number;
  minLength?: number;
  breachedCheck?: 'off' | 'dataset' | 'remote';
  breachedOnError?: 'open' | 'closed';
  // A password stored as typed, the way every hash was made before
  // passwords were normalised.
  storedAsTyped?: string;
}

interface Account {
  tenantId: string;
  subjectId: string;
}

async function seedAccount(policy: TenantPolicy = {}): Promise<Account> {
  const tenantId = newId();
  const subjectId = await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `tenant-${tenantId}`,
      passwordMaxAgeDays: policy.maxAgeDays ?? 0,
      passwordHistoryDepth: policy.historyDepth ?? 0,
      passwordMinLength: policy.minLength ?? 8,
      breachedCheck: policy.breachedCheck ?? 'dataset',
      breachedOnError: policy.breachedOnError ?? 'open',
    });
    await provisionBrowserFlow(tx, tenantId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: 'ada' });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(policy.storedAsTyped ?? PASSWORD) },
    });
    return subject.id;
  });
  return { tenantId, subjectId };
}

// The only way to stand a password in the past: created_at is written by
// the database's own now(), not by the clock a test injects.
async function agePassword(account: Account, days: number): Promise<void> {
  await withTenant(app.db, account.tenantId, (tx) =>
    tx
      .update(userCredentials)
      .set({ createdAt: sql`now() - ${`${String(days)} days`}::interval` })
      .where(
        and(eq(userCredentials.subjectId, account.subjectId), eq(userCredentials.type, 'password')),
      ),
  );
}

// The real clock, deliberately: a password's age is the distance between
// created_at, which the database writes with its own now(), and the instant
// the flow judges it at. A fake clock years from that would expire
// everything and prove nothing about the limit.
function signIn(account: Account, password: string): Promise<AdvanceOutcome> {
  return withTenant(app.db, account.tenantId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, account.tenantId, request);
    return advance(tx, authSessionId, { username: 'ada', password }, undefined, {
      logger: SILENT_LOGGER,
    });
  });
}

function pending(account: Account): Promise<string[]> {
  return withTenant(app.db, account.tenantId, (tx) =>
    requiredActionRepository(tx).pendingFor(account.subjectId),
  );
}

const NO_REQUEST = { requestId: null, ip: null };

async function change(
  account: Account,
  password: string,
  endOtherSessions?: (tx: TenantScopedDatabase) => Promise<void>,
  check: BreachedPasswordCheck = breachedCheck,
): Promise<UpdatePasswordOutcome> {
  const input = { tenantId: account.tenantId, subjectId: account.subjectId, password };
  const breachedPrepared = await prepareUpdatePassword(app.db, input, check, NO_REQUEST);
  return withTenant(app.db, account.tenantId, (tx) =>
    completeUpdatePassword(tx, {
      ...input,
      breachedCheck: check,
      breachedPrepared,
      ...(endOtherSessions === undefined ? {} : { endOtherSessions }),
    }),
  );
}

function credentialRows(account: Account): Promise<AuditEventRecord[]> {
  return withTenant(app.db, account.tenantId, (tx) =>
    auditRepository(tx).list({ eventType: 'credential', limit: 50 }),
  );
}

async function waitingLocks(): Promise<number> {
  const rows = await owner.db.execute<{ waiting: number }>(
    sql`select count(*)::int as waiting from pg_locks where not granted`,
  );
  return rows[0]?.waiting ?? 0;
}

async function awaitBlockedTransaction(): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if ((await waitingLocks()) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('no transaction ever blocked; the two writes did not overlap');
}

function historyHashes(account: Account): Promise<string[]> {
  return withTenant(app.db, account.tenantId, (tx) =>
    credentialRepository(tx).passwordHistory(account.subjectId),
  );
}

describe('a password past the tenant maximum age is changed, not refused', () => {
  it('owes update-password and still authenticates the expired password', async () => {
    const account = await seedAccount({ maxAgeDays: 90 });
    await agePassword(account, 91);

    const outcome = await signIn(account, PASSWORD);

    expect(outcome).toEqual({
      kind: 'success',
      subjectId: account.subjectId,
      authenticators: ['password'],
    });
    expect(await pending(account)).toEqual(['update-password']);
  });

  it('owes nothing for a password inside the maximum age', async () => {
    const account = await seedAccount({ maxAgeDays: 90 });
    await agePassword(account, 89);

    expect(await signIn(account, PASSWORD)).toMatchObject({ kind: 'success' });
    expect(await pending(account)).toEqual([]);
  });

  it('owes nothing in a tenant that does not age passwords out', async () => {
    const account = await seedAccount();
    await agePassword(account, 3650);

    expect(await signIn(account, PASSWORD)).toMatchObject({ kind: 'success' });
    expect(await pending(account)).toEqual([]);
  });

  // The action has to go, and the new password has to date from the change:
  // a rotation that left created_at alone would re-owe the action on the
  // very next login and never let one finish.
  it('clears the action when the password is changed, and does not re-owe it', async () => {
    const account = await seedAccount({ maxAgeDays: 90 });
    await agePassword(account, 91);
    await signIn(account, PASSWORD);

    expect(await change(account, 'a whole new passphrase')).toEqual({ kind: 'updated' });
    expect(await pending(account)).toEqual([]);

    expect(await signIn(account, 'a whole new passphrase')).toMatchObject({ kind: 'success' });
    expect(await pending(account)).toEqual([]);
  });
});

describe('the tenant password history refuses a password the subject has had', () => {
  it('refuses the password in force and the retired ones inside the depth', async () => {
    const account = await seedAccount({ historyDepth: 2 });
    await change(account, 'second passphrase here');
    await change(account, 'third passphrase here');

    expect(await change(account, 'third passphrase here')).toEqual({
      kind: 'rejected',
      violations: [
        { rule: 'not-reused', message: 'Password must not be one you have used before.' },
      ],
    });
    expect(await change(account, 'second passphrase here')).toEqual({
      kind: 'rejected',
      violations: [
        { rule: 'not-reused', message: 'Password must not be one you have used before.' },
      ],
    });
    expect(await change(account, PASSWORD)).toEqual({
      kind: 'rejected',
      violations: [
        { rule: 'not-reused', message: 'Password must not be one you have used before.' },
      ],
    });
  });

  it('accepts a password retired further back than the depth remembers', async () => {
    const account = await seedAccount({ historyDepth: 1 });
    await change(account, 'second passphrase here');
    await change(account, 'third passphrase here');

    // PASSWORD and 'second passphrase here' were both retired; a depth of
    // one keeps only the most recent of them, so the first is free again.
    expect(await change(account, PASSWORD)).toEqual({ kind: 'updated' });
  });

  it('remembers nothing, and refuses nothing, at a depth of zero', async () => {
    const account = await seedAccount();
    await change(account, 'second passphrase here');

    expect(await historyHashes(account)).toEqual([]);
    expect(await change(account, 'second passphrase here')).toEqual({ kind: 'updated' });
  });

  it('stores the retired hash as a password-history row, and only the depth of them', async () => {
    const account = await seedAccount({ historyDepth: 2 });
    const displaced = await withTenant(app.db, account.tenantId, (tx) =>
      credentialRepository(tx).passwordFor(account.subjectId),
    );

    await change(account, 'second passphrase here');
    expect(await historyHashes(account)).toEqual([displaced]);

    await change(account, 'third passphrase here');
    await change(account, 'fourth passphrase here');
    expect(await historyHashes(account)).toHaveLength(2);
    expect(await historyHashes(account)).not.toContain(displaced);
  });

  // passwordFor filters type = 'password', so a retired hash is not a
  // credential any login can reach. Pinned here because a widening of that
  // query would turn every remembered password back into a working one.
  it('never authenticates a login with a retired password', async () => {
    const account = await seedAccount({ historyDepth: 4 });
    await change(account, 'second passphrase here');

    expect(await historyHashes(account)).toHaveLength(1);
    expect(await signIn(account, PASSWORD)).toEqual({
      kind: 'failure',
      reason: 'invalid_credentials',
    });
    expect(await signIn(account, 'second passphrase here')).toMatchObject({ kind: 'success' });
  });
});

describe('the tenant password policy binds the change-password action', () => {
  it('refuses a candidate that breaks the tenant minimum length', async () => {
    const account = await seedAccount({ minLength: 12 });

    expect(await change(account, 'short')).toEqual({
      kind: 'rejected',
      violations: [
        {
          rule: 'min-length',
          message: 'Password must be at least 12 characters long.',
          minLength: 12,
        },
      ],
    });
  });

  it('refuses an empty submission against the same minimum, not as a special case', async () => {
    const account = await seedAccount();

    expect(await change(account, '')).toEqual({
      kind: 'rejected',
      violations: [
        {
          rule: 'min-length',
          message: 'Password must be at least 8 characters long.',
          minLength: 8,
        },
      ],
    });
  });

  it('collects every rule the candidate breaks, not just the first', async () => {
    const account = await seedAccount({ minLength: 20 });

    expect(await change(account, 'ada')).toEqual({
      kind: 'rejected',
      violations: [
        {
          rule: 'min-length',
          message: 'Password must be at least 20 characters long.',
          minLength: 20,
        },
        { rule: 'not-username', message: 'Password must not contain the username.' },
        {
          rule: 'common-password',
          message: 'That password is too easy to guess. Choose a different one.',
        },
      ],
    });
  });

  // A refused candidate must leave the account exactly as it was: the old
  // password still works and nothing was retired.
  it('writes nothing at all for a refused candidate', async () => {
    const account = await seedAccount({ historyDepth: 4, minLength: 12 });

    expect(await change(account, 'short')).toMatchObject({ kind: 'rejected' });

    expect(await historyHashes(account)).toEqual([]);
    expect(await signIn(account, PASSWORD)).toMatchObject({ kind: 'success' });
  });
});

describe('the change-password action writes one password.changed row', () => {
  it('writes the row for an accepted change, and none for a candidate history refuses', async () => {
    const account = await seedAccount({ historyDepth: 2 });

    expect(await change(account, 'second passphrase here')).toEqual({ kind: 'updated' });
    expect(await change(account, PASSWORD)).toMatchObject({ kind: 'rejected' });
    expect(await change(account, 'second passphrase here')).toMatchObject({ kind: 'rejected' });

    const rows = await credentialRows(account);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'password.changed',
      outcome: 'allowed',
      actorSubjectId: account.subjectId,
      resourceType: 'subject',
      resourceId: account.subjectId,
    });
  });

  it('records whether the change ended the other sessions, and ends them once', async () => {
    const account = await seedAccount();
    let ended = 0;
    const end = (): Promise<void> => {
      ended += 1;
      return Promise.resolve();
    };

    expect(await change(account, 'second passphrase here', end)).toEqual({ kind: 'updated' });
    expect(await change(account, 'third passphrase here')).toEqual({ kind: 'updated' });

    expect(ended).toBe(1);
    const rows = await credentialRows(account);
    const details = rows
      .filter((row) => row.action === 'password.changed')
      .map((row) => row.detail);
    expect(details).toHaveLength(2);
    expect(details).toContainEqual({ ended_other_sessions: true, breached_check: 'dataset_empty' });
    expect(details).toContainEqual({
      ended_other_sessions: false,
      breached_check: 'dataset_empty',
    });
  });

  it('ends no session for a refused candidate', async () => {
    const account = await seedAccount({ minLength: 12 });
    let ended = 0;
    const end = (): Promise<void> => {
      ended += 1;
      return Promise.resolve();
    };
    expect(await change(account, 'short', end)).toMatchObject({ kind: 'rejected' });
    expect(ended).toBe(0);
  });

  // The other writer holds the row while this change reads the old hash and
  // blocks on its UPDATE; once the other commits, the compare-and-swap
  // matches nothing, and the candidate this change carried is never stored.
  it('writes no row for a change another transaction superseded', async () => {
    const account = await seedAccount();
    let release: () => void = () => undefined;
    let arrive: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const written = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    const other = withTenant(app.db, account.tenantId, async (tx) => {
      await credentialRepository(tx).setPassword(
        account.subjectId,
        await hashPassword('set by the other writer'),
      );
      arrive();
      await gate;
    });
    await written;

    const superseded = change(account, 'a candidate that loses the race');
    await awaitBlockedTransaction();
    release();
    await other;

    expect(await superseded).toEqual({ kind: 'superseded' });
    expect(await credentialRows(account)).toEqual([]);
  });
});

describe('the change-password action refuses common and expected passwords', () => {
  const COMMON = {
    rule: 'common-password',
    message: 'That password is too easy to guess. Choose a different one.',
  };

  it('refuses a listed password, however it is cased, and writes nothing', async () => {
    const account = await seedAccount();

    expect(await change(account, 'BaseBall')).toEqual({ kind: 'rejected', violations: [COMMON] });
    expect(await pending(account)).toEqual([]);
    expect((await signIn(account, PASSWORD)).kind).not.toBe('failure');
  });

  it('refuses the tenant name on its own', async () => {
    const account = await seedAccount();
    const tenantName = `tenant-${account.tenantId}`;

    // The name is random hex, which may by chance hold the username `ada`,
    // so the username rule may fire beside the one under test.
    const outcome = await change(account, tenantName.toUpperCase());
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') throw new Error('not rejected');
    expect(outcome.violations).toContainEqual(COMMON);
  });

  it("does not take another tenant's name as a word to refuse", async () => {
    const mine = await seedAccount({ minLength: 8 });
    const other = await seedAccount({ minLength: 8 });

    expect(await change(mine, `tenant-${other.tenantId}`)).toEqual({ kind: 'updated' });
  });

  it('accepts a password that only contains a listed one', async () => {
    const account = await seedAccount();

    expect(await change(account, 'baseball and a long walk home')).toEqual({ kind: 'updated' });
  });
});

describe('passwords are stored NFC-normalised and verified either way', () => {
  const composed = 'caf\u00e9 au lait, deux sucres';
  const decomposed = 'cafe\u0301 au lait, deux sucres';

  it('signs in with either form of a password set through the change', async () => {
    const account = await seedAccount();

    expect(await change(account, decomposed)).toEqual({ kind: 'updated' });
    expect((await signIn(account, composed)).kind).toBe('success');
    expect((await signIn(account, decomposed)).kind).toBe('success');
  });

  it('still signs in a person whose stored hash was made from the typed bytes', async () => {
    const account = await seedAccount({ storedAsTyped: decomposed });

    expect((await signIn(account, decomposed)).kind).toBe('success');
    expect((await signIn(account, 'another password entirely')).kind).toBe('failure');
  });

  it('refuses the password in force when its hash was made from the typed bytes', async () => {
    const account = await seedAccount({ historyDepth: 2, storedAsTyped: decomposed });

    expect(await change(account, decomposed)).toEqual({
      kind: 'rejected',
      violations: [
        { rule: 'not-reused', message: 'Password must not be one you have used before.' },
      ],
    });
  });
});

describe('a hash made before passwords were normalised is upgraded at the next sign-in', () => {
  const composed = 'café au lait, deux sucres';
  const decomposed = 'café au lait, deux sucres';

  function row(account: Account) {
    return withTenant(app.db, account.tenantId, async (tx) => {
      const [found] = await tx
        .select()
        .from(userCredentials)
        .where(
          and(
            eq(userCredentials.subjectId, account.subjectId),
            eq(userCredentials.type, 'password'),
          ),
        );
      if (found === undefined) throw new Error('no password row');
      return found;
    });
  }

  it('signs in a decomposed legacy password, rehashes it from the normalised form and marks it', async () => {
    const account = await seedAccount({ storedAsTyped: decomposed });
    const before = await row(account);
    expect(before.hashNfc).toBeNull();

    expect((await signIn(account, decomposed)).kind).toBe('success');

    const after = await row(account);
    expect(after.hashNfc).toBe(true);
    expect(after.secretData).not.toEqual(before.secretData);
    expect(after.createdAt).toEqual(before.createdAt);
    const hash = (after.secretData as { hash: string }).hash;
    expect(await verifyPassword(hash, composed)).toBe(true);
    expect((await signIn(account, composed)).kind).toBe('success');
    expect((await signIn(account, decomposed)).kind).toBe('success');
  });

  it('marks a legacy hash that was already of the normalised form, without rewriting it', async () => {
    const account = await seedAccount();
    const before = await row(account);

    expect((await signIn(account, PASSWORD)).kind).toBe('success');

    const after = await row(account);
    expect(after.hashNfc).toBe(true);
    expect(after.secretData).toEqual(before.secretData);
  });

  it('leaves a legacy hash alone when the password was wrong', async () => {
    const account = await seedAccount({ storedAsTyped: decomposed });

    expect((await signIn(account, 'not the password')).kind).toBe('failure');

    expect((await row(account)).hashNfc).toBeNull();
  });

  it('marks every password it writes', async () => {
    const account = await seedAccount();
    expect(await change(account, composed)).toEqual({ kind: 'updated' });
    expect((await row(account)).hashNfc).toBe(true);
  });

  it('marks a password inserted through the repository, and a reset-style replacement', async () => {
    const account = await seedAccount();
    await withTenant(app.db, account.tenantId, async (tx) => {
      await tx.delete(userCredentials).where(eq(userCredentials.subjectId, account.subjectId));
      await credentialRepository(tx).insert({
        tenantId: account.tenantId,
        subjectId: account.subjectId,
        type: 'password',
        secret: { kind: 'password', hash: await hashUserPassword(decomposed) },
      });
    });
    expect((await row(account)).hashNfc).toBe(true);
    await withTenant(app.db, account.tenantId, async (tx) =>
      credentialRepository(tx).setPassword(account.subjectId, await hashUserPassword(composed)),
    );
    expect((await row(account)).hashNfc).toBe(true);
  });

  it('does not upgrade a subject of another tenant', async () => {
    const mine = await seedAccount({ storedAsTyped: decomposed });
    const other = await seedAccount();
    const stored = (await row(mine)).secretData as { hash: string };

    const done = await withTenant(app.db, other.tenantId, (tx) =>
      credentialRepository(tx).upgradePassword(mine.subjectId, stored.hash, null),
    );

    expect(done).toBe(false);
    expect((await row(mine)).hashNfc).toBeNull();
  });
});

describe('a password change that must prove the current password', () => {
  const NEW = 'a whole new passphrase';

  async function changeProving(account: Account, current: string): Promise<UpdatePasswordOutcome> {
    const input = { tenantId: account.tenantId, subjectId: account.subjectId, password: NEW };
    const breachedPrepared = await prepareUpdatePassword(app.db, input, breachedCheck, NO_REQUEST);
    return withTenant(app.db, account.tenantId, (tx) =>
      completeUpdatePassword(tx, {
        ...input,
        breachedCheck,
        breachedPrepared,
        currentPassword: current,
      }),
    );
  }

  const WRONG = {
    kind: 'rejected',
    violations: [expect.objectContaining({ rule: 'current-password' })],
  };

  it('changes the password when the current one is right', async () => {
    const account = await seedAccount();
    expect(await changeProving(account, PASSWORD)).toEqual({ kind: 'updated' });
    expect(await signIn(account, NEW)).toMatchObject({ kind: 'success' });
  });

  it('refuses a wrong or empty current password and changes nothing', async () => {
    const account = await seedAccount();
    expect(await changeProving(account, 'not the password')).toEqual(WRONG);
    expect(await changeProving(account, '')).toEqual(WRONG);
    expect(await signIn(account, PASSWORD)).toMatchObject({ kind: 'success' });
    expect(await credentialRows(account)).toEqual([]);
  });

  it('judges the current password before the new one, so a weak new one learns nothing', async () => {
    const account = await seedAccount({ minLength: 30 });
    expect(await changeProving(account, 'not the password')).toEqual(WRONG);
  });

  it('counts a wrong current password as a failed sign-in and refuses the right one once locked', async () => {
    const account = await seedAccount();
    await owner.sql`update tenants set brute_force_max_failures = 2 where id = ${account.tenantId}`;
    expect(await changeProving(account, 'wrong one')).toEqual(WRONG);
    expect(await changeProving(account, 'wrong two')).toEqual(WRONG);
    expect(await changeProving(account, PASSWORD)).toEqual(WRONG);
    expect(await signIn(account, PASSWORD)).toMatchObject({ kind: 'failure' });
  });

  it('ends the run of failures once the current password is right', async () => {
    const account = await seedAccount();
    await owner.sql`update tenants set brute_force_max_failures = 3 where id = ${account.tenantId}`;
    for (const wrong of ['one', 'two']) await changeProving(account, wrong);
    expect(await changeProving(account, PASSWORD)).toEqual({ kind: 'updated' });
    const rows =
      await owner.sql`select 1 from login_failures where subject_id = ${account.subjectId}`;
    expect(rows).toHaveLength(0);
  });

  it('asks for no current password where the caller gives none', async () => {
    const account = await seedAccount();
    expect(await change(account, NEW)).toEqual({ kind: 'updated' });
  });
});

describe('the breached-password check on a change', () => {
  const LEAKED = 'leaked passphrase from a breach';

  beforeAll(async () => {
    await insertBreachedHashes(owner.db, [breachedHash(LEAKED)]);
  });

  it('refuses a password in the dataset, naming the rule and changing nothing', async () => {
    const account = await seedAccount();

    expect(await change(account, LEAKED)).toEqual({
      kind: 'rejected',
      violations: [
        {
          rule: 'breached-password',
          message: 'That password has appeared in a data breach. Choose a different one.',
        },
      ],
    });

    expect(await credentialRows(account)).toEqual([]);
    expect(await signIn(account, PASSWORD)).toMatchObject({ kind: 'success' });
  });

  it('accepts the same password for a tenant that switched the check off', async () => {
    const account = await seedAccount({ breachedCheck: 'off' });

    expect(await change(account, LEAKED)).toEqual({ kind: 'updated' });

    const [row] = await credentialRows(account);
    expect(row?.detail).toEqual({ ended_other_sessions: false, breached_check: 'off' });
  });

  it('asks only a password that passed the other rules', async () => {
    const account = await seedAccount({ minLength: 40 });
    const asked: string[] = [];
    const spy: BreachedPasswordCheck = {
      ...breachedCheck,
      prepare: (database, tenantId, password, request) => {
        asked.push(password);
        return breachedCheck.prepare(database, tenantId, password, request);
      },
    };

    expect(await change(account, LEAKED, undefined, spy)).toMatchObject({
      kind: 'rejected',
      violations: [{ rule: 'min-length' }],
    });
    expect(asked).toEqual([]);
  });

  it('refuses a remote check that could not finish when the tenant fails closed', async () => {
    const down = createBreachedPasswordCheck({
      fetchRange: () => Promise.reject(new Error('unreachable')),
    });
    const closed = await seedAccount({ breachedCheck: 'remote', breachedOnError: 'closed' });
    const open = await seedAccount({ breachedCheck: 'remote', breachedOnError: 'open' });

    expect(await change(closed, 'fresh unbreached passphrase', undefined, down)).toMatchObject({
      kind: 'rejected',
      violations: [{ rule: 'breach-check-unavailable' }],
    });
    expect(await change(open, 'fresh unbreached passphrase', undefined, down)).toEqual({
      kind: 'updated',
    });
    const [row] = await credentialRows(open);
    expect(row?.detail).toEqual({ ended_other_sessions: false, breached_check: 'error_open' });
  });
});
