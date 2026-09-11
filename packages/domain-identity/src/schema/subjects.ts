import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { realms } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see realms.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
export const subjects = pgTable('subjects', {
  id: uuid('id').primaryKey(),
  realmId: uuid('realm_id')
    .notNull()
    .references(() => realms.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// Carries all three type values from the first migration so that P5's agent
// instances inherit sessions, grants and revocation instead of duplicating
// them, rather than needing a schema change when agent_instance arrives.
export interface SubjectRecord {
  id: string;
  realmId: string;
  type: 'user' | 'service' | 'agent_instance';
  disabledAt: Date | null;
}
