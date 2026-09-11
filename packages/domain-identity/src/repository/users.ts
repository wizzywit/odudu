import { type RealmScopedDatabase } from '@odudu/db';
import { eq } from 'drizzle-orm';
import { subjects, type SubjectRecord } from '#/schema/subjects';
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
  };
}
