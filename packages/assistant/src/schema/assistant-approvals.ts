import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// The card of a pending write, beside the P5 approval it belongs to. The
// foreign keys and the policy live in packages/db/drizzle/0152; the assistant
// package imports no database package, so nothing here references one.
export const assistantApprovals = pgTable('assistant_approvals', {
  tenantId: uuid('tenant_id').notNull(),
  approvalId: uuid('approval_id').primaryKey(),
  conversationId: uuid('conversation_id').notNull(),
  toolCallId: text('tool_call_id').notNull(),
  tool: text('tool').notNull(),
  card: jsonb('card').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type ApprovalCardRecord = typeof assistantApprovals.$inferSelect;
