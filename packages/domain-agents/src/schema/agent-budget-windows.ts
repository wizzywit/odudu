import { integer, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see tenants.ts in @odudu/db for why a
// declarative policy would collide with a database that already carries it.
// The writes an owner's agent client has spent in one window.
export const agentBudgetWindows = pgTable(
  'agent_budget_windows',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ownerSubjectId: uuid('owner_subject_id').notNull(),
    agentClientId: uuid('agent_client_id').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    writes: integer('writes').notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.ownerSubjectId, table.agentClientId, table.windowStart],
    }),
  ],
).enableRLS();
