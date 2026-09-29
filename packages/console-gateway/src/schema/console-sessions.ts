import { customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
});

// Policies and the composite foreign key to subjects(tenant_id, id) are
// hand-authored in packages/db/drizzle/0078_console_sessions.sql.
export const consoleSessions = pgTable('console_sessions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  subjectId: uuid('subject_id').notNull(),
  secretHash: bytea('secret_hash').notNull().unique(),
  accessTokenWrapped: text('access_token_wrapped').notNull(),
  refreshTokenWrapped: text('refresh_token_wrapped').notNull(),
  idTokenWrapped: text('id_token_wrapped').notNull(),
  accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}).enableRLS();

export const consoleLogins = pgTable('console_logins', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  stateHash: bytea('state_hash').notNull().unique(),
  verifierWrapped: text('verifier_wrapped').notNull(),
  nonce: text('nonce').notNull(),
  returnTo: text('return_to').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}).enableRLS();
