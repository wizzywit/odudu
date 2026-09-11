import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core';
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
}).enableRLS();

export interface UserRecord {
  subjectId: string;
  realmId: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
}
