import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// The foreign keys (to tenants, conversations, turns and steps), the checks, the
// indexes and the policies live in packages/db/drizzle/0153; the assistant
// package imports no database package, so nothing here references one.
export const assistantTurns = pgTable(
  'assistant_turns',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    profile: text('profile').notNull(),
    promptHash: text('prompt_hash').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    stopReason: text('stop_reason'),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
).enableRLS();

export const assistantSteps = pgTable(
  'assistant_steps',
  {
    tenantId: uuid('tenant_id').notNull(),
    turnId: uuid('turn_id').notNull(),
    id: uuid('id').notNull(),
    parentStepId: uuid('parent_step_id'),
    slot: text('slot').notNull(),
    model: text('model').notNull(),
    providerRequestId: text('provider_request_id'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
).enableRLS();

export const assistantEvents = pgTable(
  'assistant_events',
  {
    tenantId: uuid('tenant_id').notNull(),
    turnId: uuid('turn_id').notNull(),
    seq: integer('seq').notNull(),
    stepId: uuid('step_id'),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.turnId, table.seq] })],
).enableRLS();
