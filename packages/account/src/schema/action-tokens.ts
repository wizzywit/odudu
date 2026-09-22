import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see tenants.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
// The composite foreign key to subjects(tenant_id, id) lives only in the
// migration: drizzle's table builder has no way to declare it here.
export const actionTokens = pgTable('action_tokens', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id').notNull(),
  type: text('type').notNull(),
  tokenHash: text('token_hash').notNull(),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
}).enableRLS();

export type ActionTokenType = 'verify_email' | 'reset_password';

export interface ActionTokenRecord {
  id: string;
  tenantId: string;
  subjectId: string;
  type: ActionTokenType;
  tokenHash: string;
  email: string | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}
