import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { subjects } from '#/schema/subjects';

// A typed row per credential, not a password_hash column on users, so P2's
// TOTP and passkeys are inserts rather than a migration.
export const userCredentials = pgTable('user_credentials', {
  id: uuid('id').primaryKey(),
  realmId: uuid('realm_id').notNull(),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => subjects.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  secretData: text('secret_data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export interface CredentialRecord {
  id: string;
  realmId: string;
  subjectId: string;
  type: 'password';
  secretData: string;
  createdAt: Date;
}
