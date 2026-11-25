import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see tenants.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
// `instanceId` has no foreign key: an approval outlives its instance's
// tombstone and keeps naming it.
export const agentApprovals = pgTable('agent_approvals', {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  id: uuid('id').primaryKey(),
  subjectId: uuid('subject_id').notNull(),
  requestingClientId: uuid('requesting_client_id').notNull(),
  instanceId: uuid('instance_id'),
  kind: text('kind').notNull(),
  summary: text('summary').notNull(),
  actionDigest: text('action_digest').notNull(),
  // agent_approvals_state_check bounds the column.
  state: text('state').$type<AgentApprovalState>().notNull().default('pending'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  // agent_approvals_decided_via_check bounds the column.
  decidedVia: text('decided_via').$type<AgentApprovalChannel>(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type AgentApprovalState = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
export type AgentApprovalChannel = 'ciba_page' | 'console';
export type AgentApprovalRecord = typeof agentApprovals.$inferSelect;
