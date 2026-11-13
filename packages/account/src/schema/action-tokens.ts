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
  // The required actions an execute_actions link takes its subject through.
  actions: text('actions').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  // The sign-in a self-service request was made from, so the page the link
  // opens can offer that sign-in back to the browser that parked it
  // (packages/db/drizzle/0101_sign_in_resume.sql). Never in the link itself,
  // and not a foreign key: a sign-in is reaped long before its token.
  authenticationSessionId: uuid('authentication_session_id'),
  // The client an administrator-issued link returns to and the one of its
  // redirect URIs the page offers (packages/db/drizzle/0129_action_token_return.sql).
  // Both or neither; not a foreign key, because the page checks them against
  // the client's registration as it stands when the link is opened.
  clientId: uuid('client_id'),
  returnUri: text('return_uri'),
}).enableRLS();

export type ActionTokenType = 'verify_email' | 'reset_password' | 'execute_actions';

export interface ReturnTarget {
  clientId: string;
  uri: string;
}

export interface ActionTokenRecord {
  id: string;
  tenantId: string;
  subjectId: string;
  type: ActionTokenType;
  tokenHash: string;
  email: string | null;
  actions: readonly string[] | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  authenticationSessionId: string | null;
  returnTo: ReturnTarget | null;
}
