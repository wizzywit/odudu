import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Policies and the composite foreign keys (to tenants, subjects and, for a
// message, its conversation) live in packages/db/drizzle/0147; the assistant
// package imports no database package, so nothing here references one.
export const assistantConversations = pgTable(
  'assistant_conversations',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    ownerSubjectId: uuid('owner_subject_id').notNull(),
    instanceId: uuid('instance_id').notNull(),
    // The grant the conversation acts under when it is not its own id: set once a
    // conversation is carried on after a sign-in. Null means the grant stored under `id`.
    grantId: uuid('grant_id'),
    // Which run of the conversation's agent instance is current; see the migration.
    runGeneration: integer('run_generation').notNull().default(0),
    profile: text('profile').notNull(),
    mode: text('mode').notNull(),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    // Set when the owner hides the conversation from their list; nothing is removed.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // The tenant the conversation is about: its target, else its own tenant.
    scopeTenantId: uuid('scope_tenant_id').generatedAlwaysAs(
      sql`coalesce(target_tenant_id, tenant_id)`,
    ),
    // The tenant the conversation acts in when it is not its owner's own, for a
    // system administrator in another tenant; null is the owner's tenant.
    targetTenantId: uuid('target_tenant_id'),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
).enableRLS();

export const assistantMessages = pgTable(
  'assistant_messages',
  {
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    seq: integer('seq').notNull(),
    role: text('role').notNull(),
    parts: jsonb('parts').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.conversationId, table.seq] })],
).enableRLS();

export type ConversationRecord = typeof assistantConversations.$inferSelect;
export type MessageRecord = typeof assistantMessages.$inferSelect;
