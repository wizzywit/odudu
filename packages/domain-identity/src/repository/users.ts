import { type RealmScopedDatabase } from '@odudu/db';
import { OduduError } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { subjects, type SubjectRecord } from '#/schema/subjects';
import { isEmailAddress } from '#/service/email';
import { users, type UserRecord } from '#/schema/users';

export type { UserRecord } from '#/schema/users';

function toSubject(row: typeof subjects.$inferSelect): SubjectRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    type: row.type as SubjectRecord['type'],
    disabledAt: row.disabledAt,
  };
}

function toUser(row: typeof users.$inferSelect): UserRecord {
  return {
    subjectId: row.subjectId,
    realmId: row.realmId,
    username: row.username,
    email: row.email,
    emailVerified: row.emailVerified,
  };
}

export interface UserWithSubject {
  subject: SubjectRecord;
  user: UserRecord;
}

export interface NewUser {
  subjectId: string;
  realmId: string;
  username: string;
  email?: string | null;
}

export function userRepository(tx: RealmScopedDatabase) {
  return {
    // Joins subjects because class-table inheritance splits identity
    // (subject) from profile (user); the covering users_lookup index keeps
    // this in the hot path of every token issuance cheap.
    async byUsername(username: string): Promise<UserWithSubject | null> {
      const rows = await tx
        .select({ subject: subjects, user: users })
        .from(users)
        .innerJoin(subjects, eq(subjects.id, users.subjectId))
        .where(eq(users.username, username));
      const row = rows[0];
      return row === undefined ? null : { subject: toSubject(row.subject), user: toUser(row.user) };
    },

    // The claim mapper registry's lookup: an access token carries `sub`,
    // never a username, and a service or agent_instance subject has no
    // users row at all — that's a null result here, not an error.
    async bySubjectId(subjectId: string): Promise<UserRecord | null> {
      const rows = await tx.select().from(users).where(eq(users.subjectId, subjectId));
      const row = rows[0];
      return row === undefined ? null : toUser(row);
    },

    // The bootstrap seed command is the only caller today: a user profile
    // is created once its subject exists, never before.
    async create(input: NewUser): Promise<UserRecord> {
      const email = input.email ?? null;
      // OIDC Core §5.1 requires the `email` claim to conform to RFC 5322's
      // addr-spec, and the claim is emitted verbatim from this column
      // (packages/protocol-oidc/src/service/claims.ts). The column is bare
      // `text`, so this is the boundary where a non-conforming address can
      // still be refused instead of becoming a malformed claim in every
      // token and /userinfo response thereafter.
      // The rejected address stays out of the message. apps/server/src/logger.ts
      // allowlists what may be logged precisely so end-user data does not
      // reach a log line, and an error message is one `logger.error({ err })`
      // away from being one.
      if (email !== null && !isEmailAddress(email)) {
        throw new OduduError(
          'invalid_email',
          `the email given for user ${JSON.stringify(input.username)} is not an address the ` +
            'email claim may carry — see packages/domain-identity/src/service/email.ts for the ' +
            'accepted form.',
        );
      }

      const rows = await tx
        .insert(users)
        .values({
          subjectId: input.subjectId,
          realmId: input.realmId,
          username: input.username,
          email,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('insert_returned_no_row', 'insert into users returned no row');
      }
      return toUser(row);
    },
  };
}
