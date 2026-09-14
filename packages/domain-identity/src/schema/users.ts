import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { subjects } from '#/schema/subjects';

// realm_id is denormalized so this table's isolation policy needs no join
// to subjects; the composite foreign key back to subjects(realm_id, id) is
// what stops the two ever disagreeing.
export const users = pgTable('users', {
  subjectId: uuid('subject_id')
    .primaryKey()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  realmId: uuid('realm_id').notNull(),
  username: text('username').notNull(),
  email: text('email'),
  emailVerified: boolean('email_verified').notNull().default(false),
  // OIDC Core §5.1 standard claims. Each shape-constrained column carries
  // its CHECK in packages/db/drizzle/0020_user_profile.sql, on the column
  // the claim is emitted from (packages/domain-identity/src/service/profile.ts
  // holds the TypeScript spelling of the same shapes).
  name: text('name'),
  givenName: text('given_name'),
  familyName: text('family_name'),
  middleName: text('middle_name'),
  nickname: text('nickname'),
  preferredUsername: text('preferred_username'),
  profile: text('profile'),
  picture: text('picture'),
  website: text('website'),
  gender: text('gender'),
  birthdate: text('birthdate'),
  zoneinfo: text('zoneinfo'),
  locale: text('locale'),
  phoneNumber: text('phone_number'),
  phoneNumberVerified: boolean('phone_number_verified').notNull().default(false),
  profileUpdatedAt: timestamp('profile_updated_at', { withTimezone: true }),
  addressFormatted: text('address_formatted'),
  addressStreet: text('address_street'),
  addressLocality: text('address_locality'),
  addressRegion: text('address_region'),
  addressPostalCode: text('address_postal_code'),
  addressCountry: text('address_country'),
}).enableRLS();

export interface UserRecord {
  subjectId: string;
  realmId: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  middleName: string | null;
  nickname: string | null;
  preferredUsername: string | null;
  profile: string | null;
  picture: string | null;
  website: string | null;
  gender: string | null;
  birthdate: string | null;
  zoneinfo: string | null;
  locale: string | null;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  profileUpdatedAt: Date | null;
  addressFormatted: string | null;
  addressStreet: string | null;
  addressLocality: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
}
