import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type RealmScopedDatabase } from '@odudu/db';
import {
  authenticationSessions,
  type AuthenticationSessionRecord,
  type PendingRequest,
} from '#/schema/authentication-sessions';

function toRecord(row: typeof authenticationSessions.$inferSelect): AuthenticationSessionRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    pendingRequest: row.pendingRequest as PendingRequest,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    satisfied: row.satisfied,
    subjectId: row.subjectId,
    webauthnChallenge: row.webauthnChallenge,
  };
}

// tx.execute() hands back driver rows of unknown shape; parsing is what
// makes a renamed column fail here rather than flow on as a null challenge
// that would look like an expired ceremony.
const claimedChallengeRows = z.array(z.object({ challenge: z.string() }));

export interface NewAuthenticationSession {
  id: string;
  realmId: string;
  pendingRequest: PendingRequest;
  expiresAt: Date;
}

// All persistence for the parked-request row, both for the executor's own
// state-machine flow and for callers (logging, admin inspection, a future
// "resend" path) that want the row without driving `advance`.
export function authenticationSessionRepository(tx: RealmScopedDatabase) {
  return {
    async byId(id: string): Promise<AuthenticationSessionRecord | null> {
      const rows = await tx
        .select()
        .from(authenticationSessions)
        .where(eq(authenticationSessions.id, id));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    async create(values: NewAuthenticationSession): Promise<void> {
      await tx.insert(authenticationSessions).values(values);
    },

    // A single conditional UPDATE, not read-then-write: the WHERE clause is
    // the only thing standing between one successful login and two, so it
    // has to be the same statement that flips the flag. Returns whether
    // this call is the one that consumed the session — false means either
    // it never existed or a previous call (possibly racing this one) already
    // did, and the caller must not proceed as though it owns the session.
    async consume(id: string, consumedAt: Date): Promise<boolean> {
      const rows = await tx
        .update(authenticationSessions)
        .set({ consumedAt })
        .where(and(eq(authenticationSessions.id, id), isNull(authenticationSessions.consumedAt)))
        .returning({ id: authenticationSessions.id });
      return rows.length > 0;
    },

    // Appends unconditionally rather than checking membership first: the
    // executor only ever calls this once per authenticator per session (a
    // satisfied one is never re-run — see `nextStep`), so a duplicate would
    // signal a bug upstream, not something this write needs to guard
    // against. Readers treat `satisfied` as a set (`Set` membership), so an
    // accidental duplicate would be harmless even so.
    async recordSatisfied(id: string, authenticator: string): Promise<void> {
      await tx
        .update(authenticationSessions)
        .set({
          satisfied: sql`array_append(${authenticationSessions.satisfied}, ${authenticator})`,
        })
        .where(eq(authenticationSessions.id, id));
    },

    // Written on every factor that succeeds, including the one that
    // finishes the login — unlike `satisfied`, a bound subject lets no
    // factor be skipped on a retry, it only fixes who the retry has to be.
    // It is also what gives a required-action submission, which carries no
    // credentials of its own, somebody to act for.
    async bindSubject(id: string, subjectId: string): Promise<void> {
      await tx
        .update(authenticationSessions)
        .set({ subjectId })
        .where(eq(authenticationSessions.id, id));
    },

    // Issued with the registration or assertion options it belongs to, and
    // overwriting whatever a previous, abandoned ceremony left: only the
    // most recently offered challenge can be answered.
    async setWebauthnChallenge(id: string, challenge: string): Promise<void> {
      await tx
        .update(authenticationSessions)
        .set({ webauthnChallenge: challenge })
        .where(eq(authenticationSessions.id, id));
    },

    // Reads the challenge and clears it in one statement: a response is
    // verified against a challenge that no longer exists by the time the
    // verification runs, so replaying it finds null and is refused before
    // any signature is checked. The self-join is what lets RETURNING hand
    // back the pre-update value — RETURNING alone reports the new one,
    // which is always null here.
    async claimWebauthnChallenge(id: string): Promise<string | null> {
      const result = await tx.execute(sql`
        UPDATE authentication_sessions AS s
        SET webauthn_challenge = NULL
        FROM authentication_sessions AS prior
        WHERE prior.id = s.id
          AND s.id = ${id}
          AND s.webauthn_challenge IS NOT NULL
        RETURNING prior.webauthn_challenge AS challenge
      `);
      const rows = claimedChallengeRows.parse(result);
      return rows[0]?.challenge ?? null;
    },

    // Puts the attempt back to how it started, for the one refusal whose
    // remedy is a different person signing in against the same parked
    // request: an `id_token_hint` naming somebody else (OIDC Core §3.1.2.1).
    // The columns go together — a satisfied factor with no subject is the
    // state the subject binding exists to rule out, and a challenge offered
    // to the previous person is not one the next may answer.
    async resetProgress(id: string): Promise<void> {
      await tx
        .update(authenticationSessions)
        .set({ satisfied: [], subjectId: null, webauthnChallenge: null })
        .where(eq(authenticationSessions.id, id));
    },
  };
}
