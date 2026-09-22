import { type TenantScopedDatabase } from '@odudu/db';
import { eq, sql } from 'drizzle-orm';
import { loginFailures } from '#/schema/login-failures';
import { nextLockout, type LockoutPolicy } from '#/service/lockout';

export interface LoginFailureRecord {
  failureCount: number;
  firstFailureAt: Date | null;
  lastFailureAt: Date | null;
  lockedUntil: Date | null;
}

// A subject with no row has failed nothing, which is not the same as a
// subject whose row says zero — but reads the same way, and must: every
// account's first attempt starts here, so anything else would refuse every
// login in the tenant.
const NEVER_FAILED: LoginFailureRecord = {
  failureCount: 0,
  firstFailureAt: null,
  lastFailureAt: null,
  lockedUntil: null,
};

// What the one statement in `recordFailure` reports: whether the subject
// exists in this tenant at all, and whether this call was the one that moved
// the counter. Raw `tx.execute` hands back driver rows keyed by the names
// the statement gives them, with no drizzle mapping.
interface RawOutcomeRow {
  target_rows: number;
  written_rows: number;
}

// How many times a lost compare-and-swap is re-read and re-applied. A loss
// means a concurrent attempt committed a failure from the count this one
// read, so the retry is what makes *this* attempt count too instead of
// replacing that one with the same number. Exhausting the bound means this
// attempt did not move the counter at all — reported as `contended`, and
// bounded rather than harmless: the winners still increment, so the lockout
// still trips, and writers serialize on the row, so five consecutive losses
// take parallelism well past what a counter at this scale sees.
const CAS_ATTEMPTS = 5;

/**
 * The three ends of one `recordFailure`. `contended` is distinguished from
 * `no_subject` because they are opposite things: no subject is the ordinary
 * answer for a username nobody holds, and contention is an attempt that was
 * not counted, which is worth knowing about.
 */
export type RecordFailureOutcome =
  { kind: 'recorded'; state: LoginFailureRecord } | { kind: 'no_subject' } | { kind: 'contended' };

export function loginFailureRepository(tx: TenantScopedDatabase) {
  async function forSubject(subjectId: string): Promise<LoginFailureRecord> {
    const rows = await tx
      .select({
        failureCount: loginFailures.failureCount,
        firstFailureAt: loginFailures.firstFailureAt,
        lastFailureAt: loginFailures.lastFailureAt,
        lockedUntil: loginFailures.lockedUntil,
      })
      .from(loginFailures)
      .where(eq(loginFailures.subjectId, subjectId));
    return rows[0] ?? NEVER_FAILED;
  }

  return {
    forSubject,

    /**
     * Counts one failed attempt and locks the account at the tenant's
     * threshold. `no_subject` is a state the login path relies on: it hands a
     * placeholder id for an unknown username so both cost the same, and the
     * row is inserted from an RLS-scoped read of `subjects` rather than from a
     * tenant id passed in, so an id no subject holds writes nothing and
     * violates no foreign key there would be no safe place to catch.
     */
    async recordFailure(
      subjectId: string,
      policy: LockoutPolicy,
      now: Date,
    ): Promise<RecordFailureOutcome> {
      for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const observed = await forSubject(subjectId);
        const next = nextLockout(observed, policy, now);
        // A count of one is a run that has just started, whether because
        // nothing preceded it or because a quiet period broke the last one.
        const firstFailureAt = next.failureCount === 1 ? now : (observed.firstFailureAt ?? now);
        // Timestamps travel as ISO text and are cast in the statement: a raw
        // `tx.execute` bypasses the parameter conversion `.select()` and
        // `.insert()` get from drizzle, and postgres-js refuses a Date.
        const first = firstFailureAt.toISOString();
        const at = now.toISOString();
        const until = next.lockedUntil === null ? null : next.lockedUntil.toISOString();
        // The predicate on the stored count is the decision, not a record of
        // one: two attempts that read the same count serialize on the row,
        // and the second re-checks what the first committed and writes
        // nothing rather than replacing it with the same number.
        const result = await tx.execute(sql`
          WITH target AS (
            SELECT s.tenant_id, s.id FROM subjects AS s WHERE s.id = ${subjectId}
          ), written AS (
            INSERT INTO login_failures
                   (tenant_id, subject_id, failure_count, first_failure_at, last_failure_at, locked_until)
            SELECT target.tenant_id, target.id, ${next.failureCount},
                   ${first}::timestamptz, ${at}::timestamptz, ${until}::timestamptz
              FROM target
            ON CONFLICT (tenant_id, subject_id) DO UPDATE
               SET failure_count = ${next.failureCount},
                   first_failure_at = ${first}::timestamptz,
                   last_failure_at = ${at}::timestamptz,
                   locked_until = ${until}::timestamptz
             WHERE login_failures.failure_count = ${observed.failureCount}
            RETURNING 1 AS written
          )
          SELECT (SELECT count(*) FROM target)::int  AS target_rows,
                 (SELECT count(*) FROM written)::int AS written_rows
        `);
        const row = (result as unknown as RawOutcomeRow[])[0];
        if (row === undefined || row.target_rows === 0) return { kind: 'no_subject' };
        if (row.written_rows > 0) {
          return {
            kind: 'recorded',
            state: {
              failureCount: next.failureCount,
              firstFailureAt,
              lastFailureAt: now,
              lockedUntil: next.lockedUntil,
            },
          };
        }
      }
      return { kind: 'contended' };
    },

    // What a correct password does to the run of failures before it: ends
    // it. Deleting rather than zeroing keeps "no row" the only way an
    // account with nothing against it is represented.
    async clear(subjectId: string): Promise<boolean> {
      const rows = await tx
        .delete(loginFailures)
        .where(eq(loginFailures.subjectId, subjectId))
        .returning({ subjectId: loginFailures.subjectId });
      return rows.length > 0;
    },
  };
}
