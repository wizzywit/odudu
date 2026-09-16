import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withEachRealmExclusive,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  reap,
  REAP_LOCK_KEY,
  REAP_ORDER,
  type ReapOutcome,
  type RetentionPolicy,
  type TableName,
} from '#/cli/reap';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

// Every row below is placed relative to this instant and the pass is given
// the same one, so nothing here depends on how long the container took to
// start.
const NOW = new Date('2026-06-01T12:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const POLICY: RetentionPolicy = {
  grantSeconds: 7 * 24 * 60 * 60,
  offlineGrantSeconds: 30 * 24 * 60 * 60,
  authorizationCodeSeconds: 60 * 60,
  authenticationSessionSeconds: 60 * 60,
  actionTokenSeconds: 7 * 24 * 60 * 60,
  sessionSeconds: 24 * 60 * 60,
};

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

interface BruteForce {
  readonly lockoutSeconds: number;
  readonly maxLockoutSeconds: number;
  readonly failureResetSeconds: number;
}

interface Fixture {
  readonly realm: string;
  readonly realmId: string;
  readonly staleGrantId: string;
  readonly youngGrantId: string;
  readonly boundSessionId: string;
  readonly orphanSessionId: string;
}

// One realm carrying, for every reaped table, a row that is eligible and a
// row that is not. The two halves are what make a pass that deletes
// everything and a pass that deletes nothing both fail.
async function seedFixture(brute?: BruteForce): Promise<Fixture> {
  const realm = `reap-${newId()}`;
  const realmId = newId();
  const clientId = newId();
  const subjectId = newId();
  const staleFailureSubject = newId();
  const lockedSubject = newId();
  const staleGrantId = newId();
  const youngGrantId = newId();
  const boundSessionId = newId();
  const orphanSessionId = newId();

  await owner.db.execute(sql`
    INSERT INTO realms (id, name, brute_force_lockout_seconds,
                        brute_force_max_lockout_seconds, brute_force_failure_reset_seconds)
    VALUES (${realmId}, ${realm}, ${brute?.lockoutSeconds ?? 60},
            ${brute?.maxLockoutSeconds ?? 900}, ${brute?.failureResetSeconds ?? 43_200})
  `);
  await owner.db.execute(sql`
    INSERT INTO subjects (id, realm_id, type) VALUES
      (${subjectId}, ${realmId}, 'user'),
      (${staleFailureSubject}, ${realmId}, 'user'),
      (${lockedSubject}, ${realmId}, 'user')
  `);
  await owner.db.execute(sql`
    INSERT INTO clients (id, realm_id, client_id, name, type)
    VALUES (${clientId}, ${realmId}, 'app', 'App', 'public')
  `);

  // The session the young grant is bound to is itself long past its grace:
  // what keeps it is the grant, not its own expiry.
  await owner.db.execute(sql`
    INSERT INTO sessions (id, realm_id, subject_id, expires_at) VALUES
      (${boundSessionId}, ${realmId}, ${subjectId}, ${at(-2 * DAY)}::timestamptz),
      (${orphanSessionId}, ${realmId}, ${subjectId}, ${at(-2 * DAY)}::timestamptz)
  `);

  await owner.db.execute(sql`
    INSERT INTO token_grants (id, realm_id, client_id, subject_id, scope, created_at, session_id)
    VALUES
      (${staleGrantId}, ${realmId}, ${clientId}, ${subjectId}, 'openid',
       ${at(-40 * DAY)}::timestamptz, NULL),
      (${youngGrantId}, ${realmId}, ${clientId}, ${subjectId}, 'openid',
       ${at(-1 * HOUR)}::timestamptz, ${boundSessionId})
  `);

  await owner.db.execute(sql`
    INSERT INTO refresh_tokens (token_hash, realm_id, grant_id, expires_at, used_at) VALUES
      (${`rt-stale-${realmId}`}, ${realmId}, ${staleGrantId},
       ${at(-39 * DAY)}::timestamptz, ${at(-39 * DAY)}::timestamptz),
      (${`rt-live-${realmId}`}, ${realmId}, ${youngGrantId},
       ${at(1 * HOUR)}::timestamptz, NULL)
  `);

  await owner.db.execute(sql`
    INSERT INTO authorization_codes (code_hash, realm_id, client_id, subject_id, redirect_uri,
                                     scope, code_challenge, code_challenge_method, auth_time,
                                     expires_at, consumed_at, grant_id)
    VALUES
      (${`code-stale-${realmId}`}, ${realmId}, ${clientId}, ${subjectId},
       'https://app.example/cb', 'openid', 'challenge', 'S256', ${at(-40 * DAY)}::timestamptz,
       ${at(-40 * DAY)}::timestamptz, ${at(-40 * DAY)}::timestamptz, ${staleGrantId}),
      (${`code-young-${realmId}`}, ${realmId}, ${clientId}, ${subjectId},
       'https://app.example/cb', 'openid', 'challenge', 'S256', ${at(-10 * MINUTE)}::timestamptz,
       ${at(-10 * MINUTE)}::timestamptz, NULL, NULL)
  `);

  await owner.db.execute(sql`
    INSERT INTO authentication_sessions (id, realm_id, pending_request, expires_at, consumed_at)
    VALUES
      (${newId()}, ${realmId}, '{}'::jsonb, ${at(-2 * HOUR)}::timestamptz, NULL),
      (${newId()}, ${realmId}, '{}'::jsonb, ${at(1 * HOUR)}::timestamptz, NULL)
  `);

  await owner.db.execute(sql`
    INSERT INTO action_tokens (id, realm_id, subject_id, type, token_hash, expires_at, consumed_at)
    VALUES
      (${newId()}, ${realmId}, ${subjectId}, 'verify_email', ${`at-stale-${realmId}`},
       ${at(-8 * DAY)}::timestamptz, NULL),
      (${newId()}, ${realmId}, ${subjectId}, 'verify_email', ${`at-live-${realmId}`},
       ${at(1 * HOUR)}::timestamptz, NULL)
  `);

  // One row past both bounds, one still holding a lock. In a realm whose
  // lockout can outlast its quiet period, the second is the row a pass
  // keyed on the quiet period alone would delete, unlocking the account.
  await owner.db.execute(sql`
    INSERT INTO login_failures (realm_id, subject_id, failure_count, first_failure_at,
                                last_failure_at, locked_until)
    VALUES
      (${realmId}, ${staleFailureSubject}, 3, ${at(-2 * DAY)}::timestamptz,
       ${at(-1 * DAY)}::timestamptz, ${at(-1 * DAY)}::timestamptz),
      (${realmId}, ${lockedSubject}, 9, ${at(-2 * DAY)}::timestamptz,
       ${at(-1 * DAY)}::timestamptz, ${at(1 * HOUR)}::timestamptz)
  `);

  return { realm, realmId, staleGrantId, youngGrantId, boundSessionId, orphanSessionId };
}

const RELATIONS: Record<TableName, SQL> = {
  refresh_tokens: sql.raw('refresh_tokens'),
  authorization_codes: sql.raw('authorization_codes'),
  token_grants: sql.raw('token_grants'),
  authentication_sessions: sql.raw('authentication_sessions'),
  action_tokens: sql.raw('action_tokens'),
  login_failures: sql.raw('login_failures'),
  sessions: sql.raw('sessions'),
};

async function countRows(realmId: string, table: TableName): Promise<number> {
  const rows = await owner.db.execute<{ n: string }>(
    sql`SELECT count(*) AS n FROM ${RELATIONS[table]} WHERE realm_id = ${realmId}`,
  );
  return Number(rows[0]?.n ?? '-1');
}

async function counts(realmId: string): Promise<Record<TableName, number>> {
  const result = {} as Record<TableName, number>;
  for (const table of REAP_ORDER) result[table] = await countRows(realmId, table);
  return result;
}

function runPass(now: Date = NOW): Promise<ReapOutcome> {
  return reap({ database: appDb, ownerDatabase: owner }, now, POLICY);
}

function ran(outcome: ReapOutcome): Record<TableName, number> {
  if (!outcome.ran) throw new Error('the pass did not run');
  return outcome.deleted;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  appDb = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('odudu reap', () => {
  // First, and deliberately: the report is summed over every realm in the
  // database, so this is the only point at which it can be compared to an
  // exact expectation.
  it('deletes every eligible row, counts each one, and then has nothing left to do', async () => {
    const fixture = await seedFixture();

    expect(ran(await runPass())).toEqual({
      refresh_tokens: 1,
      authorization_codes: 1,
      token_grants: 1,
      authentication_sessions: 1,
      action_tokens: 1,
      login_failures: 1,
      sessions: 1,
    });

    // Reported by this pass, not by the ON DELETE CASCADE from
    // token_grants: a cascade would have emptied refresh_tokens while the
    // report claimed nothing had happened there.
    expect(await counts(fixture.realmId)).toEqual({
      refresh_tokens: 1,
      authorization_codes: 1,
      token_grants: 1,
      authentication_sessions: 1,
      action_tokens: 1,
      login_failures: 1,
      sessions: 1,
    });

    expect(ran(await runPass())).toEqual({
      refresh_tokens: 0,
      authorization_codes: 0,
      token_grants: 0,
      authentication_sessions: 0,
      action_tokens: 0,
      login_failures: 0,
      sessions: 0,
    });
  });

  it('keeps a session a grant still references, without nulling the grant', async () => {
    const fixture = await seedFixture();
    await runPass();

    const sessions = await owner.db.execute<{ id: string }>(
      sql`SELECT id FROM sessions WHERE realm_id = ${fixture.realmId}`,
    );
    expect(sessions.map((row) => row.id)).toEqual([fixture.boundSessionId]);

    // The ON DELETE SET NULL on token_grants.session_id never fired, which
    // is the point: a nulled session_id would have promoted a session-bound
    // grant to an offline one.
    const grants = await owner.db.execute<{ session_id: string | null }>(
      sql`SELECT session_id FROM token_grants WHERE id = ${fixture.youngGrantId}`,
    );
    expect(grants[0]?.session_id).toBe(fixture.boundSessionId);
  });

  it('deletes a session in the same pass as the last grant that referenced it', async () => {
    const fixture = await seedFixture();
    await runPass();

    // Eight days on, the session-bound family is past its own retention;
    // the session becomes deletable only because the grant went first.
    const deleted = ran(await runPass(new Date(NOW.getTime() + 8 * DAY)));
    expect(deleted.token_grants).toBeGreaterThanOrEqual(1);
    expect(await countRows(fixture.realmId, 'token_grants')).toBe(0);
    expect(await countRows(fixture.realmId, 'sessions')).toBe(0);
    expect(await countRows(fixture.realmId, 'refresh_tokens')).toBe(0);
  });

  // The CHECK in packages/db/drizzle/0041_login_failures.sql relates
  // max_lockout_seconds to lockout_seconds and bounds failure_reset_seconds,
  // but relates neither to the other: a realm that locks for a day and
  // forgets failures after a minute is legal, and there the quiet period
  // alone would delete the row holding the lock.
  it('keeps a locked-out account whose quiet period has already elapsed', async () => {
    const fixture = await seedFixture({
      lockoutSeconds: 60,
      maxLockoutSeconds: 86_400,
      failureResetSeconds: 60,
    });

    await runPass();

    const rows = await owner.db.execute<{ locked: boolean }>(sql`
      SELECT locked_until > ${NOW.toISOString()}::timestamptz AS locked
        FROM login_failures WHERE realm_id = ${fixture.realmId}
    `);
    expect(rows.map((row) => row.locked)).toEqual([true]);
  });

  it('lifts the row once the lock itself has expired', async () => {
    const fixture = await seedFixture({
      lockoutSeconds: 60,
      maxLockoutSeconds: 86_400,
      failureResetSeconds: 60,
    });

    await runPass(new Date(NOW.getTime() + 2 * HOUR));

    expect(await countRows(fixture.realmId, 'login_failures')).toBe(0);
  });

  // No DELETE in the pass carries a realm_id predicate: the scoping is
  // realms_isolation, on the connection the statements run on. A pass over
  // one realm must therefore leave every other realm untouched.
  it('scopes each realm’s statements by row-level security alone', async () => {
    const mine = await seedFixture();
    const theirs = await seedFixture();

    const before = await counts(theirs.realmId);
    const pass = await withEachRealmExclusive(appDb.db, REAP_LOCK_KEY, [mine.realmId], (tx) =>
      tx.execute(sql`DELETE FROM authentication_sessions`),
    );
    expect(pass.acquired).toBe(true);

    expect(await countRows(mine.realmId, 'authentication_sessions')).toBe(0);
    expect(await counts(theirs.realmId)).toEqual(before);

    await runPass();
  });

  it('skips its pass rather than queueing behind a holder of the retention lock', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalHeld!: () => void;
    const acquired = new Promise<void>((resolve) => {
      signalHeld = resolve;
    });

    // Held open for the length of the contending pass, so it meets a live
    // holder rather than a released one.
    const blocking = appDb.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_try_advisory_xact_lock(${REAP_LOCK_KEY}::bigint)`);
      signalHeld();
      await held;
    });
    await acquired;

    const contender = await runPass();
    expect(contender.ran).toBe(false);

    release();
    await blocking;
  });

  // A table that carries a lifecycle timestamp either has a retention rule
  // or is named here with a reason. `email_outbox` will arrive carrying
  // `sent_at`, and this is what will not let it arrive unreaped.
  const NOT_REAPED: Record<string, string> = {};

  it('accounts for every table carrying a lifecycle timestamp', async () => {
    const rows = await owner.db.execute<{ table_name: string }>(sql`
      SELECT DISTINCT table_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name IN ('expires_at', 'consumed_at', 'used_at', 'sent_at',
                             'failed_at', 'locked_until', 'last_failure_at')
       ORDER BY table_name
    `);

    const unaccounted = rows
      .map((row) => row.table_name)
      .filter(
        (table) =>
          !(REAP_ORDER as readonly string[]).includes(table) && NOT_REAPED[table] === undefined,
      );
    expect(unaccounted).toEqual([]);
  });
});
