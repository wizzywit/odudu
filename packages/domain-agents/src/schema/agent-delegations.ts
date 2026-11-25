import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see tenants.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
// `clientId` is the client the subject signs in with; `actorClientId` is the
// client allowed to act for them, within `scopeCeiling`.
export const agentDelegations = pgTable('agent_delegations', {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  id: uuid('id').primaryKey(),
  subjectId: uuid('subject_id').notNull(),
  clientId: uuid('client_id').notNull(),
  actorClientId: uuid('actor_client_id').notNull(),
  scopeCeiling: text('scope_ceiling').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type AgentDelegationRecord = typeof agentDelegations.$inferSelect;
