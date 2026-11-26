import {
  bigint,
  boolean,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Policies, the foreign keys to tenants and the expression unique index on
// (tenant, scope, key, coalesce(slot, '')) live in packages/db/drizzle/0148.
export const assistantBudgetCounters = pgTable('assistant_budget_counters', {
  tenantId: uuid('tenant_id').notNull(),
  scopeKind: text('scope_kind').notNull(),
  scopeKey: text('scope_key').notNull(),
  slot: text('slot'),
  used: bigint('used', { mode: 'number' }).notNull().default(0),
  limitTokens: bigint('limit_tokens', { mode: 'number' }).notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
}).enableRLS();

export const assistantReservations = pgTable(
  'assistant_reservations',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    turnId: uuid('turn_id').notNull(),
    slot: text('slot').notNull(),
    reserved: bigint('reserved', { mode: 'number' }).notNull(),
    levels: jsonb('levels').notNull(),
    sent: boolean('sent').notNull().default(false),
    settled: boolean('settled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
).enableRLS();
