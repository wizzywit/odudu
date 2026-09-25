import { tenants } from '@odudu/db';
import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// `tenant_id` is the tenant an event happened *to*, not the actor's own —
// a system admin changing tenant U writes a row U's own administrators can
// read, and keying on the actor's tenant would hide it from exactly those
// people. The actor columns are nullable: an authentication event has no
// administrator behind it, and those rows land here too rather than in a
// second table.
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .default(sql`nullif(current_setting('app.tenant_id', true), '')::uuid`)
    .references(() => tenants.id, { onDelete: 'cascade' }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  eventType: text('event_type').notNull(),
  action: text('action').notNull(),
  outcome: text('outcome').notNull(),
  actorTenantId: uuid('actor_tenant_id'),
  actorSubjectId: uuid('actor_subject_id'),
  actorClientId: uuid('actor_client_id'),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  requestId: text('request_id'),
  ip: text('ip'),
  detail: jsonb('detail').notNull().default({}),
}).enableRLS();

export type AuditEventRecord = typeof auditEvents.$inferSelect;
