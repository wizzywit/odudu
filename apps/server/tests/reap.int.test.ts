import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withEachTenantExclusive,
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
let appUrl: string;

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
  registrationTokenSeconds: 7 * 24 * 60 * 60,
  sessionSeconds: 24 * 60 * 60,
  emailSentSeconds: 7 * 24 * 60 * 60,
  emailFailedSeconds: 30 * 24 * 60 * 60,
  emailMaxAttempts: 5,
  logoutDeliveredSeconds: 7 * 24 * 60 * 60,
  logoutFailedSeconds: 30 * 24 * 60 * 60,
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
  readonly tenant: string;
  readonly tenantId: string;
  readonly staleGrantId: string;
  readonly youngGrantId: string;
  readonly boundSessionId: string;
  readonly orphanSessionId: string;
  readonly sentLongAgoId: string;
  readonly sentYesterdayId: string;
  readonly failedLongAgoId: string;
  readonly failedYesterdayId: string;
  readonly neverAttemptedId: string;
  readonly abandonedId: string;
  readonly logoutDeliveredLongAgoId: string;
  readonly logoutDeliveredYesterdayId: string;
  readonly logoutAbandonedLongAgoId: string;
  readonly logoutAbandonedYesterdayId: string;
  readonly logoutStillRetryingId: string;
  readonly assertionJtiStale: string;
  readonly assertionJtiLive: string;
}

// One tenant carrying, for every reaped table, a row that is eligible and a
// row that is not. The two halves are what make a pass that deletes
// everything and a pass that deletes nothing both fail.
async function seedFixture(brute?: BruteForce): Promise<Fixture> {
  const tenant = `reap-${newId()}`;
  const tenantId = newId();
  const clientId = newId();
  const subjectId = newId();
  const staleFailureSubject = newId();
  const lockedSubject = newId();
  const staleGrantId = newId();
  const youngGrantId = newId();
  const boundSessionId = newId();
  const orphanSessionId = newId();
  const sentLongAgoId = newId();
  const sentYesterdayId = newId();
  const failedLongAgoId = newId();
  const failedYesterdayId = newId();
  const neverAttemptedId = newId();
  const abandonedId = newId();
  const logoutDeliveredLongAgoId = newId();
  const logoutDeliveredYesterdayId = newId();
  const logoutAbandonedLongAgoId = newId();
  const logoutAbandonedYesterdayId = newId();
  const logoutStillRetryingId = newId();
  const assertionJtiStale = `jti-stale-${tenantId}`;
  const assertionJtiLive = `jti-live-${tenantId}`;

  await owner.db.execute(sql`
    INSERT INTO tenants (id, name, brute_force_lockout_seconds,
                        brute_force_max_lockout_seconds, brute_force_failure_reset_seconds)
    VALUES (${tenantId}, ${tenant}, ${brute?.lockoutSeconds ?? 60},
            ${brute?.maxLockoutSeconds ?? 900}, ${brute?.failureResetSeconds ?? 43_200})
  `);
  await owner.db.execute(sql`
    INSERT INTO subjects (id, tenant_id, type) VALUES
      (${subjectId}, ${tenantId}, 'user'),
      (${staleFailureSubject}, ${tenantId}, 'user'),
      (${lockedSubject}, ${tenantId}, 'user')
  `);
  await owner.db.execute(sql`
    INSERT INTO clients (id, tenant_id, client_id, name, type)
    VALUES (${clientId}, ${tenantId}, 'app', 'App', 'public')
  `);

  // The session the young grant is bound to is itself long past its grace:
  // what keeps it is the grant, not its own expiry.
  await owner.db.execute(sql`
    INSERT INTO sessions (id, tenant_id, subject_id, expires_at) VALUES
      (${boundSessionId}, ${tenantId}, ${subjectId}, ${at(-2 * DAY)}::timestamptz),
      (${orphanSessionId}, ${tenantId}, ${subjectId}, ${at(-2 * DAY)}::timestamptz)
  `);

  await owner.db.execute(sql`
    INSERT INTO token_grants (id, tenant_id, client_id, subject_id, scope, created_at, session_id)
    VALUES
      (${staleGrantId}, ${tenantId}, ${clientId}, ${subjectId}, 'openid',
       ${at(-40 * DAY)}::timestamptz, NULL),
      (${youngGrantId}, ${tenantId}, ${clientId}, ${subjectId}, 'openid',
       ${at(-1 * HOUR)}::timestamptz, ${boundSessionId})
  `);

  await owner.db.execute(sql`
    INSERT INTO refresh_tokens (token_hash, tenant_id, grant_id, expires_at, used_at) VALUES
      (${`rt-stale-${tenantId}`}, ${tenantId}, ${staleGrantId},
       ${at(-39 * DAY)}::timestamptz, ${at(-39 * DAY)}::timestamptz),
      (${`rt-live-${tenantId}`}, ${tenantId}, ${youngGrantId},
       ${at(1 * HOUR)}::timestamptz, NULL)
  `);

  await owner.db.execute(sql`
    INSERT INTO authorization_codes (code_hash, tenant_id, client_id, subject_id, redirect_uri,
                                     scope, code_challenge, code_challenge_method, auth_time,
                                     expires_at, consumed_at, grant_id)
    VALUES
      (${`code-stale-${tenantId}`}, ${tenantId}, ${clientId}, ${subjectId},
       'https://app.example/cb', 'openid', 'challenge', 'S256', ${at(-40 * DAY)}::timestamptz,
       ${at(-40 * DAY)}::timestamptz, ${at(-40 * DAY)}::timestamptz, ${staleGrantId}),
      (${`code-young-${tenantId}`}, ${tenantId}, ${clientId}, ${subjectId},
       'https://app.example/cb', 'openid', 'challenge', 'S256', ${at(-10 * MINUTE)}::timestamptz,
       ${at(-10 * MINUTE)}::timestamptz, NULL, NULL)
  `);

  await owner.db.execute(sql`
    INSERT INTO authentication_sessions (id, tenant_id, pending_request, expires_at, consumed_at)
    VALUES
      (${newId()}, ${tenantId}, '{}'::jsonb, ${at(-2 * HOUR)}::timestamptz, NULL),
      (${newId()}, ${tenantId}, '{}'::jsonb, ${at(1 * HOUR)}::timestamptz, NULL)
  `);

  await owner.db.execute(sql`
    INSERT INTO action_tokens (id, tenant_id, subject_id, type, token_hash, expires_at, consumed_at)
    VALUES
      (${newId()}, ${tenantId}, ${subjectId}, 'verify_email', ${`at-stale-${tenantId}`},
       ${at(-8 * DAY)}::timestamptz, NULL),
      (${newId()}, ${tenantId}, ${subjectId}, 'verify_email', ${`at-live-${tenantId}`},
       ${at(1 * HOUR)}::timestamptz, NULL)
  `);

  await owner.db.execute(sql`
    INSERT INTO client_registration_tokens (id, tenant_id, token_hash, remaining_uses, expires_at)
    VALUES
      (${newId()}, ${tenantId}, ${`crt-stale-${tenantId}`}, 1, ${at(-8 * DAY)}::timestamptz),
      (${newId()}, ${tenantId}, ${`crt-live-${tenantId}`}, 1, ${at(1 * HOUR)}::timestamptz)
  `);

  // One row past both bounds, one still holding a lock. In a tenant whose
  // lockout can outlast its quiet period, the second is the row a pass
  // keyed on the quiet period alone would delete, unlocking the account.
  await owner.db.execute(sql`
    INSERT INTO login_failures (tenant_id, subject_id, failure_count, first_failure_at,
                                last_failure_at, locked_until)
    VALUES
      (${tenantId}, ${staleFailureSubject}, 3, ${at(-2 * DAY)}::timestamptz,
       ${at(-1 * DAY)}::timestamptz, ${at(-1 * DAY)}::timestamptz),
      (${tenantId}, ${lockedSubject}, 9, ${at(-2 * DAY)}::timestamptz,
       ${at(-1 * DAY)}::timestamptz, ${at(1 * HOUR)}::timestamptz)
  `);

  // The six states a queued message can be in when a pass arrives, and only
  // two of them are the pass's business: delivered long ago, and refused
  // for the last time long enough ago that an operator has had their window
  // to read why. One delivered yesterday, one refused yesterday, one never
  // attempted, and one whose attempts went to claims that were never
  // resolved — a spent budget with no error on file, which no transport
  // ever refused — are none of its business.
  await owner.db.execute(sql`
    INSERT INTO email_outbox (id, tenant_id, to_address, subject, body_text, body_html,
                              created_at, next_attempt_at, sent_at, attempts, last_error)
    VALUES
      (${sentLongAgoId}, ${tenantId}, 'ada@example.test', 'Sent', 't', '<p>t</p>',
       ${at(-9 * DAY)}::timestamptz, ${at(-9 * DAY)}::timestamptz, ${at(-8 * DAY)}::timestamptz,
       1, NULL),
      (${sentYesterdayId}, ${tenantId}, 'ada@example.test', 'Sent', 't', '<p>t</p>',
       ${at(-2 * DAY)}::timestamptz, ${at(-2 * DAY)}::timestamptz, ${at(-1 * DAY)}::timestamptz,
       1, NULL),
      (${failedLongAgoId}, ${tenantId}, 'ada@example.test', 'Failed', 't', '<p>t</p>',
       ${at(-40 * DAY)}::timestamptz, ${at(-31 * DAY)}::timestamptz, NULL, 5, 'no such mailbox'),
      (${failedYesterdayId}, ${tenantId}, 'ada@example.test', 'Failed', 't', '<p>t</p>',
       ${at(-3 * DAY)}::timestamptz, ${at(-1 * DAY)}::timestamptz, NULL, 5, 'no such mailbox'),
      (${neverAttemptedId}, ${tenantId}, 'ada@example.test', 'Waiting', 't', '<p>t</p>',
       ${at(-60 * DAY)}::timestamptz, ${at(-60 * DAY)}::timestamptz, NULL, 0, NULL),
      (${abandonedId}, ${tenantId}, 'ada@example.test', 'Abandoned', 't', '<p>t</p>',
       ${at(-60 * DAY)}::timestamptz, ${at(-40 * DAY)}::timestamptz, NULL, 5, NULL)
  `);

  // The same shape as email_outbox's own fixture, one column renamed:
  // delivered long ago, delivered yesterday, abandoned (attempts spent,
  // an error on file) long ago, abandoned yesterday, and one still inside
  // its retry budget however old it is.
  await owner.db.execute(sql`
    INSERT INTO backchannel_logout_deliveries (id, tenant_id, client_id, session_id, endpoint,
                                               logout_token, created_at, next_attempt_at,
                                               delivered_at, attempts, last_error)
    VALUES
      (${logoutDeliveredLongAgoId}, ${tenantId}, ${clientId}, ${newId()},
       'https://rp.example/backchannel', 'token', ${at(-9 * DAY)}::timestamptz,
       ${at(-9 * DAY)}::timestamptz, ${at(-9 * DAY)}::timestamptz, 1, NULL),
      (${logoutDeliveredYesterdayId}, ${tenantId}, ${clientId}, ${newId()},
       'https://rp.example/backchannel', 'token', ${at(-2 * DAY)}::timestamptz,
       ${at(-2 * DAY)}::timestamptz, ${at(-1 * DAY)}::timestamptz, 1, NULL),
      (${logoutAbandonedLongAgoId}, ${tenantId}, ${clientId}, ${newId()},
       'https://rp.example/backchannel', 'token', ${at(-40 * DAY)}::timestamptz,
       ${at(-31 * DAY)}::timestamptz, NULL, 5, 'logout delivery refused with status 400'),
      (${logoutAbandonedYesterdayId}, ${tenantId}, ${clientId}, ${newId()},
       'https://rp.example/backchannel', 'token', ${at(-3 * DAY)}::timestamptz,
       ${at(-1 * DAY)}::timestamptz, NULL, 5, 'logout delivery refused with status 400'),
      (${logoutStillRetryingId}, ${tenantId}, ${clientId}, ${newId()},
       'https://rp.example/backchannel', 'token', ${at(-400 * DAY)}::timestamptz,
       ${at(-399 * DAY)}::timestamptz, NULL, 4, 'logout delivery failed with status 503')
  `);

  // One jti already past the exp its own claim carried, one still short of
  // it — no separate policy window, so age alone decides.
  await owner.db.execute(sql`
    INSERT INTO client_assertion_jti (tenant_id, oauth_client_id, jti, expires_at)
    VALUES
      (${tenantId}, 'app', ${assertionJtiStale}, ${at(-1 * MINUTE)}::timestamptz),
      (${tenantId}, 'app', ${assertionJtiLive}, ${at(1 * HOUR)}::timestamptz)
  `);

  return {
    tenant,
    tenantId,
    staleGrantId,
    youngGrantId,
    boundSessionId,
    orphanSessionId,
    sentLongAgoId,
    sentYesterdayId,
    failedLongAgoId,
    failedYesterdayId,
    neverAttemptedId,
    abandonedId,
    logoutDeliveredLongAgoId,
    logoutDeliveredYesterdayId,
    logoutAbandonedLongAgoId,
    logoutAbandonedYesterdayId,
    logoutStillRetryingId,
    assertionJtiStale,
    assertionJtiLive,
  };
}

const RELATIONS: Record<TableName, SQL> = {
  refresh_tokens: sql.raw('refresh_tokens'),
  authorization_codes: sql.raw('authorization_codes'),
  token_grants: sql.raw('token_grants'),
  authentication_sessions: sql.raw('authentication_sessions'),
  action_tokens: sql.raw('action_tokens'),
  client_registration_tokens: sql.raw('client_registration_tokens'),
  login_failures: sql.raw('login_failures'),
  email_outbox: sql.raw('email_outbox'),
  backchannel_logout_deliveries: sql.raw('backchannel_logout_deliveries'),
  client_assertion_jti: sql.raw('client_assertion_jti'),
  sessions: sql.raw('sessions'),
};

async function countRows(tenantId: string, table: TableName): Promise<number> {
  const rows = await owner.db.execute<{ n: string }>(
    sql`SELECT count(*) AS n FROM ${RELATIONS[table]} WHERE tenant_id = ${tenantId}`,
  );
  return Number(rows[0]?.n ?? '-1');
}

async function counts(tenantId: string): Promise<Record<TableName, number>> {
  const result = {} as Record<TableName, number>;
  for (const table of REAP_ORDER) result[table] = await countRows(tenantId, table);
  return result;
}

function runPass(now: Date = NOW, policy: RetentionPolicy = POLICY): Promise<ReapOutcome> {
  return reap({ database: appDb, ownerDatabase: owner }, now, policy);
}

async function codeExists(tenantId: string): Promise<boolean> {
  const rows = await owner.db.execute<{ n: string }>(sql`
    SELECT count(*) AS n FROM authorization_codes WHERE code_hash = ${`code-stale-${tenantId}`}
  `);
  return rows[0]?.n === '1';
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

  appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  appDb = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('odudu reap', () => {
  // First, and deliberately: the report is summed over every tenant in the
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
      client_registration_tokens: 1,
      login_failures: 1,
      email_outbox: 2,
      backchannel_logout_deliveries: 2,
      client_assertion_jti: 1,
      sessions: 1,
    });

    // Reported by this pass, not by the ON DELETE CASCADE from
    // token_grants: a cascade would have emptied refresh_tokens while the
    // report claimed nothing had happened there.
    expect(await counts(fixture.tenantId)).toEqual({
      refresh_tokens: 1,
      authorization_codes: 1,
      token_grants: 1,
      authentication_sessions: 1,
      action_tokens: 1,
      client_registration_tokens: 1,
      login_failures: 1,
      email_outbox: 4,
      backchannel_logout_deliveries: 3,
      client_assertion_jti: 1,
      sessions: 1,
    });

    expect(ran(await runPass())).toEqual({
      refresh_tokens: 0,
      authorization_codes: 0,
      token_grants: 0,
      authentication_sessions: 0,
      action_tokens: 0,
      client_registration_tokens: 0,
      login_failures: 0,
      email_outbox: 0,
      backchannel_logout_deliveries: 0,
      client_assertion_jti: 0,
      sessions: 0,
    });
  });

  // The count above is satisfied equally by deleting the stale row or the
  // live one — one seeded of each, one deleted either way — so which one
  // survives is asserted by name.
  it('keeps the jti that has not yet reached its own expiry', async () => {
    const fixture = await seedFixture();

    await runPass();

    const rows = await owner.db.execute<{ jti: string }>(
      sql`SELECT jti FROM client_assertion_jti WHERE tenant_id = ${fixture.tenantId}`,
    );
    expect(rows.map((row) => row.jti)).toEqual([fixture.assertionJtiLive]);
  });

  // The foreign-tenant probe for this table specifically: the
  // generic "scopes each tenant's statements by row-level security alone"
  // test below hard-codes authentication_sessions and never runs this
  // table's own DELETE, so it proves nothing about client_assertion_jti.
  it('scopes the client_assertion_jti delete to one tenant by row-level security alone', async () => {
    const mine = await seedFixture();
    const theirs = await seedFixture();

    const before = await countRows(theirs.tenantId, 'client_assertion_jti');
    const pass = await withEachTenantExclusive(appDb.db, REAP_LOCK_KEY, [mine.tenantId], (tx) =>
      tx.execute(sql`
        DELETE FROM client_assertion_jti
         WHERE expires_at < ${NOW.toISOString()}::timestamptz
      `),
    );
    expect(pass.acquired).toBe(true);

    // Only mine's stale row is gone; the live one it seeded stays.
    expect(await countRows(mine.tenantId, 'client_assertion_jti')).toBe(1);
    expect(await countRows(theirs.tenantId, 'client_assertion_jti')).toBe(before);

    await runPass();
  });

  // The counts above are satisfied by a rule that deletes any two of the
  // five, so which two survived is asserted by name. Nothing an operator
  // has not yet had a chance to read may go: this schema records a
  // permanent failure as a spent attempt budget and nothing else, so the
  // window that protects it is measured from the last attempt.
  it('keeps every queued message an operator could still need to read', async () => {
    const fixture = await seedFixture();

    await runPass();

    const rows = await owner.db.execute<{ id: string }>(
      sql`SELECT id FROM email_outbox WHERE tenant_id = ${fixture.tenantId} ORDER BY created_at`,
    );
    expect(rows.map((row) => row.id).sort()).toEqual(
      [
        fixture.neverAttemptedId,
        fixture.failedYesterdayId,
        fixture.sentYesterdayId,
        fixture.abandonedId,
      ].sort(),
    );
  });

  // The same property, for the queue a session's own logout writes to:
  // delivered yesterday, abandoned yesterday, and one still inside its
  // retry budget survive; delivered and abandoned long ago do not.
  it('keeps every queued logout delivery an operator could still need to read', async () => {
    const fixture = await seedFixture();

    await runPass();

    const rows = await owner.db.execute<{ id: string }>(sql`
      SELECT id FROM backchannel_logout_deliveries WHERE tenant_id = ${fixture.tenantId}
       ORDER BY created_at
    `);
    expect(rows.map((row) => row.id).sort()).toEqual(
      [
        fixture.logoutDeliveredYesterdayId,
        fixture.logoutAbandonedYesterdayId,
        fixture.logoutStillRetryingId,
      ].sort(),
    );
  });

  // `attempts` is counted by the claim, before the send, so a sender killed
  // between the two spends one without any transport having refused
  // anything. A row that spent its whole budget that way carries no
  // `last_error`, and deleting it would delete the only record of a message
  // that never went out, with nothing for an operator to have read.
  it('keeps a spent message that no transport ever refused', async () => {
    const fixture = await seedFixture();

    await runPass(new Date(NOW.getTime() + 400 * DAY));

    const rows = await owner.db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM email_outbox WHERE id = ${fixture.abandonedId}`,
    );
    expect(rows[0]?.n).toBe('1');
  });

  // A message still inside its retry schedule has attempts on it but has
  // not spent them, and is not a failure yet however old it is.
  it('keeps a message that is still being retried, whatever its age', async () => {
    const fixture = await seedFixture();
    const id = newId();
    await owner.db.execute(sql`
      INSERT INTO email_outbox (id, tenant_id, to_address, subject, body_text, body_html,
                                created_at, next_attempt_at, attempts)
      VALUES (${id}, ${fixture.tenantId}, 'ada@example.test', 'Retrying', 't', '<p>t</p>',
              ${at(-400 * DAY)}::timestamptz, ${at(-399 * DAY)}::timestamptz, 4)
    `);

    await runPass();

    const rows = await owner.db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM email_outbox WHERE id = ${id}`,
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('keeps a session a grant still references, without nulling the grant', async () => {
    const fixture = await seedFixture();
    await runPass();

    const sessions = await owner.db.execute<{ id: string }>(
      sql`SELECT id FROM sessions WHERE tenant_id = ${fixture.tenantId}`,
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
    expect(await countRows(fixture.tenantId, 'token_grants')).toBe(0);
    expect(await countRows(fixture.tenantId, 'sessions')).toBe(0);
    expect(await countRows(fixture.tenantId, 'refresh_tokens')).toBe(0);
  });

  // The CHECK in packages/db/drizzle/0041_login_failures.sql relates
  // max_lockout_seconds to lockout_seconds and bounds failure_reset_seconds,
  // but relates neither to the other: a tenant that locks for a day and
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
        FROM login_failures WHERE tenant_id = ${fixture.tenantId}
    `);
    expect(rows.map((row) => row.locked)).toEqual([true]);
  });

  // The branch the shared fixture cannot exercise: a token spent
  // (remaining_uses = 0) well inside its own ttl has no spent_at to measure
  // a window from, so the window runs from created_at instead.
  it('keeps a spent registration token until its own window clears created_at', async () => {
    const fixture = await seedFixture();
    const spentId = newId();
    await owner.db.execute(sql`
      INSERT INTO client_registration_tokens (id, tenant_id, token_hash, remaining_uses,
                                              created_at, expires_at)
      VALUES (${spentId}, ${fixture.tenantId}, ${`crt-spent-${fixture.tenantId}`}, 0,
              ${at(-1 * HOUR)}::timestamptz, ${at(1 * DAY)}::timestamptz)
    `);

    await runPass();
    expect(await countRows(fixture.tenantId, 'client_registration_tokens')).toBeGreaterThanOrEqual(
      1,
    );
    const rows = await owner.db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM client_registration_tokens WHERE id = ${spentId}`,
    );
    expect(rows[0]?.n).toBe('1');

    await runPass(new Date(NOW.getTime() + 8 * DAY));
    const rowsAfter = await owner.db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM client_registration_tokens WHERE id = ${spentId}`,
    );
    expect(rowsAfter[0]?.n).toBe('0');
  });

  it('lifts the row once the lock itself has expired', async () => {
    const fixture = await seedFixture({
      lockoutSeconds: 60,
      maxLockoutSeconds: 86_400,
      failureResetSeconds: 60,
    });

    await runPass(new Date(NOW.getTime() + 2 * HOUR));

    expect(await countRows(fixture.tenantId, 'login_failures')).toBe(0);
  });

  // No DELETE in the pass carries a tenant_id predicate: the scoping is
  // tenants_isolation, on the connection the statements run on. A pass over
  // one tenant must therefore leave every other tenant untouched.
  it('scopes each tenant’s statements by row-level security alone', async () => {
    const mine = await seedFixture();
    const theirs = await seedFixture();

    const before = await counts(theirs.tenantId);
    const pass = await withEachTenantExclusive(appDb.db, REAP_LOCK_KEY, [mine.tenantId], (tx) =>
      tx.execute(sql`DELETE FROM authentication_sessions`),
    );
    expect(pass.acquired).toBe(true);

    expect(await countRows(mine.tenantId, 'authentication_sessions')).toBe(0);
    expect(await counts(theirs.tenantId)).toEqual(before);

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

  // authorization_codes.grant_id carries no foreign key, so nothing removes
  // the row when its grant goes and an EXISTS against the departed grant is
  // false for good. Reachable on a legal configuration: the code window
  // accepts up to a year while the grant window defaults to a week, so the
  // family can be reaped first and the code left holding on to its own age.
  it('reaps a consumed code whose grant was already removed', async () => {
    const patient: RetentionPolicy = { ...POLICY, authorizationCodeSeconds: 400 * 24 * 60 * 60 };
    const fixture = await seedFixture();

    await runPass(NOW, patient);
    expect(await countRows(fixture.tenantId, 'token_grants')).toBe(1);
    expect(await codeExists(fixture.tenantId)).toBe(true);

    // Its own window has elapsed too now, and the family it named is long
    // gone: nothing can read this row, which is the whole test of whether it
    // may be deleted.
    await runPass(new Date(NOW.getTime() + 500 * DAY), patient);
    expect(await codeExists(fixture.tenantId)).toBe(false);
  });

  // The enumeration is the one read on the owner connection, and `tenants`
  // carries FORCE ROW LEVEL SECURITY: a role without the exemption reads no
  // tenants and would reap none of them silently.
  it('refuses to run on a connection that cannot enumerate tenants', async () => {
    await expect(reap({ database: appDb, ownerDatabase: appDb }, NOW, POLICY)).rejects.toThrow(
      /bypasses row-level security/u,
    );
  });

  // The other half of the same property. The container's owner is a
  // superuser, so handing it in as the serving connection is exactly the
  // configuration an operator reaches by pointing ODUDU_APP_DATABASE_URL at
  // the owner: every DELETE unscoped, with app.tenant_id bound and nothing
  // enforcing it.
  it('refuses to delete on a connection that escapes the tenant policy', async () => {
    await expect(reap({ database: owner, ownerDatabase: owner }, NOW, POLICY)).rejects.toThrow(
      /must be subject to it/u,
    );
  });

  it('says it enumerated nothing rather than reporting a clean pass', async () => {
    const name = `reap_empty_${Date.now().toString(36)}`;
    await owner.sql.unsafe(`CREATE DATABASE ${name}`);

    const ownerUrl = new URL(container.adminUrl);
    ownerUrl.pathname = `/${name}`;
    const emptyOwner = createDatabase(ownerUrl.toString(), { max: 1 });
    // odudu_svc is a cluster-level role and already holds odudu_app, so the
    // migrations run below are all this fresh database needs for it to
    // connect under the policy.
    const servingUrl = new URL(appUrl);
    servingUrl.pathname = `/${name}`;
    const emptyServing = createDatabase(servingUrl.toString(), { max: 1 });

    try {
      await runMigrations(emptyOwner.db, MIGRATIONS_DIR);
      const outcome = await reap(
        { database: emptyServing, ownerDatabase: emptyOwner },
        NOW,
        POLICY,
      );
      expect(outcome).toEqual({ ran: false, reason: 'no tenant was enumerated' });
    } finally {
      await emptyServing.close();
      await emptyOwner.close();
    }
  }, 120_000);

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
