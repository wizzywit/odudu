import {
  bypassesRowLevelSecurity,
  createDatabase,
  realms,
  withEachRealmExclusive,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { loadConfig, OduduError, type Config } from '@odudu/kernel';
import { sql, type SQL } from 'drizzle-orm';

/**
 * The tables `reap` is answerable for. A name added here has no rule until
 * `RETENTION_RULES` gains one, which is a compile error, and no place in
 * the pass until `REAP_ORDER` gains one, which `reap` refuses to run
 * without.
 */
export type TableName =
  | 'refresh_tokens'
  | 'authorization_codes'
  | 'token_grants'
  | 'authentication_sessions'
  | 'action_tokens'
  | 'client_registration_tokens'
  | 'login_failures'
  | 'email_outbox'
  | 'sessions';

/** Rows deleted per table, summed over every realm the pass visited. */
export type ReapReport = Record<TableName, number>;

/**
 * Why a pass did nothing. Distinct from a report of zeros, at both levels:
 * "deleted nothing", "another instance is deleting instead of me" and "found
 * nothing to look at" are three different facts, and a scheduled job that
 * conflates them reports success for work nobody did.
 */
export type ReapSkipReason =
  'another instance holds the retention lock' | 'no realm was enumerated';

export type ReapOutcome =
  | { readonly ran: false; readonly reason: ReapSkipReason }
  | { readonly ran: true; readonly deleted: ReapReport };

/**
 * One window per table that has one of its own, in seconds. `refresh_tokens`
 * is absent by decision (ADR 0021): a refresh token is retained for the life
 * of its grant family, never for a period of its own. `login_failures` is
 * absent because its window is the realm's `brute_force_failure_reset_seconds`
 * — an operator who shortened retention there would be unlocking accounts.
 */
export interface RetentionPolicy {
  readonly grantSeconds: number;
  readonly offlineGrantSeconds: number;
  readonly authorizationCodeSeconds: number;
  readonly authenticationSessionSeconds: number;
  readonly actionTokenSeconds: number;
  readonly registrationTokenSeconds: number;
  readonly sessionSeconds: number;
  readonly emailSentSeconds: number;
  readonly emailFailedSeconds: number;
  /**
   * The sender's own ceiling (`ODUDU_OUTBOX_MAX_ATTEMPTS`), read here
   * rather than restated: a message that has spent it will never be
   * attempted again, and that is the only way this schema records a
   * permanent failure — there is no `failed_at` to read.
   */
  readonly emailMaxAttempts: number;
}

export function retentionPolicyFromConfig(config: Config): RetentionPolicy {
  return {
    grantSeconds: config.ODUDU_RETENTION_GRANT_SECONDS,
    offlineGrantSeconds: config.ODUDU_RETENTION_OFFLINE_GRANT_SECONDS,
    authorizationCodeSeconds: config.ODUDU_RETENTION_AUTHORIZATION_CODE_SECONDS,
    authenticationSessionSeconds: config.ODUDU_RETENTION_AUTHENTICATION_SESSION_SECONDS,
    actionTokenSeconds: config.ODUDU_RETENTION_ACTION_TOKEN_SECONDS,
    registrationTokenSeconds: config.ODUDU_RETENTION_REGISTRATION_TOKEN_SECONDS,
    sessionSeconds: config.ODUDU_RETENTION_SESSION_SECONDS,
    emailSentSeconds: config.ODUDU_RETENTION_EMAIL_SENT_SECONDS,
    emailFailedSeconds: config.ODUDU_RETENTION_EMAIL_FAILED_SECONDS,
    emailMaxAttempts: config.ODUDU_OUTBOX_MAX_ATTEMPTS,
  };
}

/**
 * Arbitrary but fixed, and the same in every replica: one key means one
 * instance reaps every realm, which is what this pass wants. Advisory locks
 * are not realm-scoped and cannot be made so — per-realm reaping would need
 * a deliberate per-realm key, which nothing asks for.
 */
export const REAP_LOCK_KEY = 20_260_915;

interface RetentionRule {
  /** Tables whose rows this one's predicate assumes are already gone. */
  readonly after: readonly TableName[];
  readonly statement: (now: Date, policy: RetentionPolicy) => SQL;
}

// Written against the aliases `g` (token_grants) and `r` (realms): every
// statement that uses this binds both. A family is past retention once its
// age exceeds the window — floored by the realm's own maximum session life,
// so a window configured shorter than the grant it retains cannot be
// expressed — and once no refresh token of it is still usable, which is
// what stops a retention pass killing a token a client holds.
function grantPastRetention(now: Date, policy: RetentionPolicy): SQL {
  return sql`
    g.created_at < ${now.toISOString()}::timestamptz - make_interval(secs => greatest(
      CASE WHEN g.session_id IS NULL
        THEN ${policy.offlineGrantSeconds}::integer
        ELSE ${policy.grantSeconds}::integer
      END,
      r.sso_session_max_seconds))
    AND NOT EXISTS (
      SELECT 1 FROM refresh_tokens live
       WHERE live.realm_id = g.realm_id
         AND live.grant_id = g.id
         AND live.used_at IS NULL
         AND live.expires_at > ${now.toISOString()}::timestamptz)
  `;
}

const RETENTION_RULES: Record<TableName, RetentionRule> = {
  // Deleted here rather than left to the ON DELETE CASCADE on
  // refresh_tokens_grant_fk: a cascade deletes the rows without this pass
  // counting them, so the report would show nothing for a table that had
  // just been emptied.
  refresh_tokens: {
    after: [],
    statement: (now, policy) => sql`
      DELETE FROM refresh_tokens t
       USING token_grants g, realms r
       WHERE g.realm_id = t.realm_id
         AND g.id = t.grant_id
         AND r.id = g.realm_id
         AND ${grantPastRetention(now, policy)}
    `,
  },

  // A code that produced a grant goes with the family, never on its own
  // expiry: the consumed row is what RFC 6749 §4.1.2's revocation on replay
  // is reached through. One that produced none has no family to wait for.
  //
  // The third disjunct is the one that is easy to omit. `grant_id` carries no
  // foreign key, so nothing removes this row when its grant goes, and an
  // `EXISTS` against a grant that no longer exists is false forever — a code
  // retained for good, in the table ADR 0021 exists to bound.
  authorization_codes: {
    after: [],
    statement: (now, policy) => sql`
      DELETE FROM authorization_codes c
       WHERE c.expires_at < ${now.toISOString()}::timestamptz
             - make_interval(secs => ${policy.authorizationCodeSeconds}::integer)
         AND (
           c.grant_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM token_grants gone
              WHERE gone.realm_id = c.realm_id AND gone.id = c.grant_id)
           OR EXISTS (
             SELECT 1 FROM token_grants g
               JOIN realms r ON r.id = g.realm_id
              WHERE g.realm_id = c.realm_id
                AND g.id = c.grant_id
                AND ${grantPastRetention(now, policy)})
         )
    `,
  },

  token_grants: {
    after: ['refresh_tokens', 'authorization_codes'],
    statement: (now, policy) => sql`
      DELETE FROM token_grants g
       USING realms r
       WHERE r.id = g.realm_id
         AND ${grantPastRetention(now, policy)}
    `,
  },

  // The shortest window of the lot, and where nearly all the volume is: no
  // revocation reads one of these rows back, so a replayed consumed row is
  // refused and nothing else follows from it (ADR 0021).
  authentication_sessions: {
    after: [],
    statement: (now, policy) => sql`
      DELETE FROM authentication_sessions s
       WHERE (s.consumed_at IS NOT NULL
              AND s.consumed_at < ${now.toISOString()}::timestamptz
                  - make_interval(secs => ${policy.authenticationSessionSeconds}::integer))
          OR s.expires_at < ${now.toISOString()}::timestamptz
             - make_interval(secs => ${policy.authenticationSessionSeconds}::integer)
    `,
  },

  action_tokens: {
    after: [],
    statement: (now, policy) => sql`
      DELETE FROM action_tokens a
       WHERE (a.consumed_at IS NOT NULL
              AND a.consumed_at < ${now.toISOString()}::timestamptz
                  - make_interval(secs => ${policy.actionTokenSeconds}::integer))
          OR a.expires_at < ${now.toISOString()}::timestamptz
             - make_interval(secs => ${policy.actionTokenSeconds}::integer)
    `,
  },

  // Copied from action_tokens, but with no spent_at to measure a spent
  // token's window from — only created_at and the ttl-bound expires_at —
  // so a token spent (remaining_uses = 0) well inside its ttl waits on
  // created_at instead. Later than action_tokens' own bound in that case,
  // by at most this table's own ttl, and with the same effect: nothing
  // still readable here can authorize a registration (RFC 7591 §3).
  client_registration_tokens: {
    after: [],
    statement: (now, policy) => sql`
      DELETE FROM client_registration_tokens t
       WHERE (t.remaining_uses = 0
              AND t.created_at < ${now.toISOString()}::timestamptz
                  - make_interval(secs => ${policy.registrationTokenSeconds}::integer))
          OR t.expires_at < ${now.toISOString()}::timestamptz
             - make_interval(secs => ${policy.registrationTokenSeconds}::integer)
    `,
  },

  // Two bounds, and the second does not follow from the first: nothing
  // relates brute_force_max_lockout_seconds to
  // brute_force_failure_reset_seconds (realms_brute_force_bounds,
  // packages/db/drizzle/0041_login_failures.sql), so a realm locking for a
  // day while forgetting failures after a minute is legal — and there the
  // quiet period alone would delete the row holding the lock, unlocking
  // accounts as a scheduled job. A row with no last failure is kept.
  login_failures: {
    after: [],
    statement: (now) => sql`
      DELETE FROM login_failures f
       USING realms r
       WHERE r.id = f.realm_id
         AND f.last_failure_at IS NOT NULL
         AND f.last_failure_at <= ${now.toISOString()}::timestamptz
             - make_interval(secs => r.brute_force_failure_reset_seconds)
         AND (f.locked_until IS NULL OR f.locked_until <= ${now.toISOString()}::timestamptz)
    `,
  },

  // Two windows, because a queued message reaches this table by two ends. A
  // delivered one is bounded from its delivery. One that never arrived has
  // no `failed_at`, so a permanent failure is a spent attempt budget with a
  // reason on file, measured from `next_attempt_at` — the instant the
  // sender would next have tried, so the window runs from the last attempt
  // and not from when the message was queued. A spent budget with no
  // `last_error` was refused by no transport: its attempts went to claims
  // whose leases expired, and it gives an operator nothing to have seen.
  email_outbox: {
    after: [],
    statement: (now, policy) => sql`
      DELETE FROM email_outbox m
       WHERE (m.sent_at IS NOT NULL
              AND m.sent_at < ${now.toISOString()}::timestamptz
                  - make_interval(secs => ${policy.emailSentSeconds}::integer))
          OR (m.sent_at IS NULL
              AND m.attempts >= ${policy.emailMaxAttempts}::integer
              AND m.last_error IS NOT NULL
              AND m.next_attempt_at < ${now.toISOString()}::timestamptz
                  - make_interval(secs => ${policy.emailFailedSeconds}::integer))
    `,
  },

  // Last, and only once nothing points at it. The ON DELETE SET NULL on
  // token_grants.session_id is a backstop this must never reach: nulling a
  // session-bound grant's session would promote it to an offline one, which
  // is a privilege change wearing a cleanup's clothes. A grant inserted
  // between this NOT EXISTS and the commit would still fire it; nothing
  // does, because the row is already past its expires_at plus the grace and
  // `sessionRepository.liveById` refuses to issue anything on a session
  // that is that far dead.
  sessions: {
    after: ['token_grants'],
    statement: (now, policy) => sql`
      DELETE FROM sessions s
       WHERE s.expires_at < ${now.toISOString()}::timestamptz
             - make_interval(secs => ${policy.sessionSeconds}::integer)
         AND NOT EXISTS (
           SELECT 1 FROM token_grants g
            WHERE g.realm_id = s.realm_id AND g.session_id = s.id)
    `,
  },
};

/**
 * The sequence, which is a correctness property and not a performance one:
 * the rows that reference a grant are deleted before the grant, so the
 * cascade never fires and the counts are real, and sessions come last,
 * because a session is only deletable once nothing references it.
 */
export const REAP_ORDER: readonly TableName[] = [
  'refresh_tokens',
  'authorization_codes',
  'token_grants',
  'authentication_sessions',
  'action_tokens',
  'client_registration_tokens',
  'login_failures',
  'email_outbox',
  'sessions',
];

/**
 * Throws unless the order covers every rule exactly once and every rule's
 * `after` precedes it. Checked before the first DELETE, so a reordering
 * that breaks the pass stops it rather than half-running it.
 */
export function assertReapOrder(order: readonly TableName[] = REAP_ORDER): void {
  const rules = Object.keys(RETENTION_RULES) as TableName[];
  const missing = rules.filter((table) => !order.includes(table));
  if (missing.length > 0) {
    throw new Error(`reap order omits ${missing.join(', ')}`);
  }
  const duplicated = order.filter((table, index) => order.indexOf(table) !== index);
  if (duplicated.length > 0) {
    throw new Error(`reap order repeats ${duplicated.join(', ')}`);
  }

  for (const [index, table] of order.entries()) {
    for (const dependency of RETENTION_RULES[table].after) {
      if (order.indexOf(dependency) >= index) {
        throw new Error(`reap order puts ${table} before ${dependency}, which it depends on`);
      }
    }
  }
}

function emptyReport(): ReapReport {
  const report = {} as Record<TableName, number>;
  for (const table of REAP_ORDER) report[table] = 0;
  return report;
}

async function reapRealm(
  tx: RealmScopedDatabase,
  now: Date,
  policy: RetentionPolicy,
): Promise<ReapReport> {
  const report = emptyReport();
  for (const table of REAP_ORDER) {
    const result = await tx.execute(RETENTION_RULES[table].statement(now, policy));
    report[table] = result.count;
  }
  return report;
}

export interface ReapDeps {
  /** The serving, row-level-security-constrained connection: every DELETE. */
  readonly database: DatabaseHandle;
  /**
   * The owner connection, for one thing: listing the realms to visit.
   * `realms_isolation` scopes that table to `app.realm_id`, and the realm
   * ids are what a realm context would have to be built from, so the list
   * cannot be read from inside one (ADR 0009's amendment of 2026-09-13).
   */
  readonly ownerDatabase: DatabaseHandle;
}

// Both halves of ADR 0021's claim that the policy is the scoping, checked
// rather than hoped for. `realms` carries FORCE ROW LEVEL SECURITY, which
// removes even the owner's implicit exemption, so a listing role without
// the escape reads zero realms and the pass visits none of them; and a
// serving role *with* the escape runs every DELETE unscoped while
// `app.realm_id` is bound, which is one unfiltered pass per realm and no
// error to say so. Both fail closed.
async function assertRolesAreRight(deps: ReapDeps): Promise<void> {
  if (!(await bypassesRowLevelSecurity(deps.ownerDatabase))) {
    throw new OduduError(
      'reap_cannot_enumerate_realms',
      'reap must list realms on a connection that bypasses row-level security; ' +
        'ODUDU_DATABASE_URL names a role that is neither SUPERUSER nor BYPASSRLS',
    );
  }
  if (await bypassesRowLevelSecurity(deps.database)) {
    throw new OduduError(
      'reap_serving_role_bypasses_rls',
      'reap deletes under the realm policy, so its serving connection must be subject to it; ' +
        'ODUDU_APP_DATABASE_URL names a SUPERUSER or BYPASSRLS role',
    );
  }
}

/**
 * Deletes what no decision can still read, in every realm, under one
 * advisory lock. Every window is measured against `now` rather than the
 * database's clock, so a test can place a pass wherever it needs one.
 */
export async function reap(
  deps: ReapDeps,
  now: Date,
  policy: RetentionPolicy,
): Promise<ReapOutcome> {
  assertReapOrder();
  await assertRolesAreRight(deps);

  const rows = await deps.ownerDatabase.db
    .select({ id: realms.id })
    .from(realms)
    .orderBy(realms.id);
  const realmIds = rows.map((row) => row.id);
  // Trustworthy, after the check above: an empty list means an empty
  // database and not a filtered read. Still said out loud, because a report
  // of zeros for a database nobody has seeded reads as a healthy pass.
  if (realmIds.length === 0) {
    return { ran: false, reason: 'no realm was enumerated' };
  }

  const pass = await withEachRealmExclusive(deps.database.db, REAP_LOCK_KEY, realmIds, (tx) =>
    reapRealm(tx, now, policy),
  );
  if (!pass.acquired) {
    return { ran: false, reason: 'another instance holds the retention lock' };
  }

  const deleted = emptyReport();
  for (const realmReport of pass.values) {
    for (const table of REAP_ORDER) deleted[table] += realmReport[table];
  }
  return { ran: true, deleted };
}

// Reads its own configuration and opens its own connections, the way the
// seed command does, so a scheduler — cron, a Kubernetes Job, or an
// operator at a shell — can invoke it as a one-shot process.
export async function reapCommand(): Promise<ReapOutcome> {
  const config = loadConfig();
  const appUrl = config.ODUDU_APP_DATABASE_URL;
  // Demanded in every environment, not only production, and unlike the
  // boot guard this command never reaches: the owner has to bypass
  // row-level security for the realm enumeration to work at all, so
  // falling back to it would run every DELETE with the policy switched
  // off — one unscoped pass per realm, and ADR 0021's claim that the
  // policy is the scoping made false. A job that refuses to start is the
  // better failure.
  if (appUrl === undefined) {
    throw new OduduError(
      'reap_requires_app_database_url',
      'reap requires ODUDU_APP_DATABASE_URL: its deletes run under the realm policy, ' +
        'which the owner role the migrations use escapes',
    );
  }

  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const runtime = createDatabase(appUrl);

  try {
    return await reap(
      { database: runtime, ownerDatabase: owner },
      new Date(),
      retentionPolicyFromConfig(config),
    );
  } finally {
    await runtime.close();
    await owner.close();
  }
}
