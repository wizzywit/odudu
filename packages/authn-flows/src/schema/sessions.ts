import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';

// realm_id is denormalized so this table's isolation policy needs no join to
// subjects; the composite foreign key back to subjects(realm_id, id) — see
// packages/db/drizzle/0006_sessions.sql — is what stops the two disagreeing.
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  realmId: uuid('realm_id')
    .notNull()
    .references(() => realms.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}).enableRLS();

export interface SessionRecord {
  id: string;
  realmId: string;
  subjectId: string;
  createdAt: Date;
  expiresAt: Date;
}
