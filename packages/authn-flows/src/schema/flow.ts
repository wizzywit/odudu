import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { type FlowStepSettings } from '@odudu/contracts/admin';
import { tenants } from '@odudu/db';

export const REQUIREMENTS = ['required', 'alternative', 'conditional', 'disabled'] as const;
export type Requirement = (typeof REQUIREMENTS)[number];

export interface FlowStep {
  authenticator: string;
  requirement: Requirement;
  // What this step overrides of the tenant's authenticator settings; a key
  // left out takes the tenant's value.
  settings?: FlowStepSettings | undefined;
}

// Policies are written as hand-authored SQL in packages/db/drizzle/, never
// declared with pgPolicy() — see tenants.ts in @odudu/db for why.
//
// A flow is one flat, ordered list of steps: consecutive ALTERNATIVE steps
// form a group ("passkey or password") without a tree walker, and
// CONDITIONAL steps decide their own applicability. The order is the
// array's own order inside `steps`. A tenant has exactly one default flow
// (packages/db/drizzle/0137_flows.sql).
export const flows = pgTable('flows', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  steps: jsonb('steps').$type<FlowStep[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export interface Flow {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
  steps: FlowStep[];
}
