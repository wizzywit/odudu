import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy(). The composite foreign keys to clients and
// subjects, the one to agent_approvals and the checks live only there
// (0143_ciba_requests.sql). A request whose hint resolved to nobody has no
// subject and no approval; it can only expire.
export const cibaRequests = pgTable('ciba_requests', {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  id: uuid('id').primaryKey(),
  authReqHash: text('auth_req_hash').notNull(),
  clientId: uuid('client_id').notNull(),
  subjectId: uuid('subject_id'),
  approvalId: uuid('approval_id'),
  hintDigest: text('hint_digest').notNull(),
  scope: text('scope').notNull(),
  // The validated text as written; whatever shows it escapes it.
  bindingMessage: text('binding_message'),
  requestedExpiry: integer('requested_expiry'),
  intervalSeconds: integer('interval_seconds').notNull().default(5),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type CibaRequestRecord = typeof cibaRequests.$inferSelect;
