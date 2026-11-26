import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Defaults, ranges and the isolation policy live in
// packages/db/drizzle/0149; the assistant package imports no database package.
export const assistantSettings = pgTable('assistant_settings', {
  tenantId: uuid('tenant_id').primaryKey(),
  assistantEnabled: boolean('assistant_enabled').notNull().default(true),
  assistantDefaultMode: text('assistant_default_mode').notNull().default('ask'),
  assistantMaskEmails: boolean('assistant_mask_emails').notNull().default(false),
  assistantTraceRetentionDays: integer('assistant_trace_retention_days').notNull().default(30),
  assistantAuditorVisible: boolean('assistant_auditor_visible').notNull().default(false),
  assistantMonthlyTokensFast: bigint('assistant_monthly_tokens_fast', { mode: 'number' })
    .notNull()
    .default(2_000_000),
  assistantMonthlyTokensStandard: bigint('assistant_monthly_tokens_standard', { mode: 'number' })
    .notNull()
    .default(5_000_000),
  assistantMonthlyTokensDeep: bigint('assistant_monthly_tokens_deep', { mode: 'number' })
    .notNull()
    .default(1_000_000),
  assistantMaxConcurrent: integer('assistant_max_concurrent').notNull().default(5),
  assistantMaxStepsPerTurn: integer('assistant_max_steps_per_turn').notNull().default(20),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type AssistantSettingsRecord = typeof assistantSettings.$inferSelect;
