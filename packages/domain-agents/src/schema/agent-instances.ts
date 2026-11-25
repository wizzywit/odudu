import { integer, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see tenants.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
// `id` is also the id of the instance's `subjects` row of type
// agent_instance; the composite foreign keys to subjects, clients and
// token_grants live only in packages/db/drizzle/0141_agent_identity.sql.
export const agentInstances = pgTable('agent_instances', {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  id: uuid('id').primaryKey(),
  ownerSubjectId: uuid('owner_subject_id').notNull(),
  agentClientId: uuid('agent_client_id').notNull(),
  parentInstanceId: uuid('parent_instance_id'),
  rootGrantId: uuid('root_grant_id').notNull(),
  depth: smallint('depth').notNull(),
  scope: text('scope').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // Set only on an instance whose life slides with use.
  idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  // The writes the instance may spend and what it has spent; a nested
  // instance's limits are what its parent had left when it was minted.
  sliceMutating: integer('slice_mutating').notNull().default(20),
  sliceCreates: integer('slice_creates').notNull().default(10),
  spentMutating: integer('spent_mutating').notNull().default(0),
  spentCreates: integer('spent_creates').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type AgentInstanceRecord = typeof agentInstances.$inferSelect;
