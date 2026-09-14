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
    name: row.name,
    givenName: row.givenName,
    familyName: row.familyName,
    middleName: row.middleName,
    nickname: row.nickname,
    preferredUsername: row.preferredUsername,
    profile: row.profile,
    picture: row.picture,
    website: row.website,
    gender: row.gender,
    birthdate: row.birthdate,
    zoneinfo: row.zoneinfo,
    locale: row.locale,
    phoneNumber: row.phoneNumber,
    phoneNumberVerified: row.phoneNumberVerified,
    profileUpdatedAt: row.profileUpdatedAt,
    addressFormatted: row.addressFormatted,
    addressStreet: row.addressStreet,
    addressLocality: row.addressLocality,
    addressRegion: row.addressRegion,
    addressPostalCode: row.addressPostalCode,
    addressCountry: row.addressCountry,
  };
}

// Every field a caller may set through updateProfile: every OIDC Core §5.1
// claim column except the identity columns (subjectId, realmId, username)
// and email, which create() and its own validation already own.
export interface ProfileUpdate {
  name?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  middleName?: string | null;
  nickname?: string | null;
  preferredUsername?: string | null;
  profile?: string | null;
  picture?: string | null;
  website?: string | null;
  gender?: string | null;
  birthdate?: string | null;
  zoneinfo?: string | null;
  locale?: string | null;
  phoneNumber?: string | null;
  phoneNumberVerified?: boolean;
  addressFormatted?: string | null;
  addressStreet?: string | null;
  addressLocality?: string | null;
  addressRegion?: string | null;
  addressPostalCode?: string | null;
  addressCountry?: string | null;
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
      // An earlier, friendlier refusal than the users_email_addr_spec CHECK
      // that actually constrains the column (OIDC Core §5.1; see
      // service/email.ts). The rejected address stays out of the message:
      // apps/server/src/logger.ts allowlists what may be logged so end-user
      // data cannot reach a log line, and an error message is one
      // `logger.error({ err })` away from being one.
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

    // RLS is the realm filter here, not a realm_id predicate on this query:
    // an update targeting another realm's subject matches zero rows and
    // returns nothing, which this method turns into a not-found error
    // rather than a silent no-op.
    async updateProfile(subjectId: string, patch: ProfileUpdate): Promise<UserRecord> {
      const rows = await tx
        .update(users)
        .set({ ...patch, profileUpdatedAt: new Date() })
        .where(eq(users.subjectId, subjectId))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('user_not_found', `user ${subjectId} not found`);
      }
      return toUser(row);
    },
  };
}
